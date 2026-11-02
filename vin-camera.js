// Live VIN camera controls: pinch/zoom button for the camera (never the page),
// a steady flashlight, continuous focus, and the guide box as a region of the
// camera frame so the barcode reader can look there first.
// Hardware zoom/torch use MediaStreamTrack constraints where the browser offers
// them (Chrome on Android); otherwise zoom is a digital crop of the preview and
// the flashlight button stays hidden.

const DIGITAL={min:1,max:4,step:0.1};
export const ZOOM_STEPS=[1,2,3];

// Zoom/torch/focus support reported by the camera track.
export function cameraFeatures(track) {
  let caps={};try{caps=track?.getCapabilities?.()||{};}catch{}
  const zoom=caps.zoom&&Number.isFinite(caps.zoom.max)&&caps.zoom.max>(caps.zoom.min??1)?{min:caps.zoom.min??1,max:caps.zoom.max,step:caps.zoom.step||0.1}:null;
  return {zoom,torch:caps.torch===true||(Array.isArray(caps.torch)&&caps.torch.includes(true)),focus:Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous')};
}

// New zoom after fingers moved from `startDistance` to `distance` apart.
export function pinchZoom(startZoom,startDistance,distance,{min,max,step}) {
  if(!(startDistance>0)||!(distance>0))return startZoom;
  const raw=startZoom*distance/startDistance,stepped=Math.round(raw/step)*step;
  return Math.min(max,Math.max(min,Number(stepped.toFixed(3))));
}
// The zoom button cycles 1x -> 2x -> 3x -> 1x, limited to what the camera allows.
export function nextZoomStep(current,{min,max}) {
  const steps=ZOOM_STEPS.map(z=>Math.min(max,Math.max(min,z))).filter((z,i,a)=>a.indexOf(z)===i);
  return steps.find(z=>z>current+0.05)??steps[0];
}

// The guide box (screen rectangle) as fractions of the camera frame, for a video
// shown with object-fit: cover. `videoRect` is the element's on-screen box,
// including any digital-zoom transform. A little margin keeps barcode ends in.
export function guideRegion(videoRect,intrinsic,guideRect,margin=0.06) {
  const {width:iw,height:ih}=intrinsic||{};
  if(!(iw>0&&ih>0&&videoRect?.width>0&&videoRect?.height>0&&guideRect?.width>0&&guideRect?.height>0))return null;
  const scale=Math.max(videoRect.width/iw,videoRect.height/ih);
  const left=videoRect.left+(videoRect.width-iw*scale)/2,top=videoRect.top+(videoRect.height-ih*scale)/2;
  const padX=guideRect.width*margin,padY=guideRect.height*margin*2;
  const x0=Math.max(0,(guideRect.left-padX-left)/(iw*scale)),y0=Math.max(0,(guideRect.top-padY-top)/(ih*scale));
  const x1=Math.min(1,(guideRect.left+guideRect.width+padX-left)/(iw*scale)),y1=Math.min(1,(guideRect.top+guideRect.height+padY-top)/(ih*scale));
  return x1>x0&&y1>y0?{x:x0,y:y0,width:x1-x0,height:y1-y0}:null;
}

export function createCameraControls({root,video,guide,zoomButton,torchButton,onMessage=()=>{}}) {
  let track=null,features={zoom:null,torch:false,focus:false},zoom=1,torchOn=false,pending=null,applying=false;
  const pointers=new Map();let pinchStart=null;
  const range=()=>features.zoom||DIGITAL;
  function showZoom(){zoomButton.textContent=(Math.round(zoom*10)/10).toString().replace(/\.0$/,'')+'×';zoomButton.setAttribute('aria-label','Zoom '+zoomButton.textContent+'. Tap to change, or pinch the picture.');}
  // Hardware zoom is applied at most one request at a time; the latest value wins.
  async function applyZoom(value){
    zoom=value;showZoom();
    if(!features.zoom){root.style.setProperty('--vin-zoom',String(zoom));return;}
    pending=value;if(applying)return;applying=true;
    try{while(pending!==null){const next=pending;pending=null;await track.applyConstraints({advanced:[{zoom:next}]});}}
    catch{features.zoom=null;root.style.setProperty('--vin-zoom',String(zoom));}
    finally{applying=false;}
  }
  async function setTorch(on){
    if(!track||!features.torch)return;
    try{await track.applyConstraints({advanced:[{torch:on}]});torchOn=on;}
    catch{torchOn=false;onMessage('The flashlight could not be turned on. Try more light, or Take photo.');}
    torchButton.setAttribute('aria-pressed',String(torchOn));torchButton.classList.toggle('on',torchOn);
    torchButton.querySelector('.vin-cam-label').textContent=torchOn?'Light on':'Light';
  }
  const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
  function down(event){if(event.target.closest('button'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2)pinchStart={zoom,distance:distance()};}
  function move(event){
    if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2&&pinchStart){event.preventDefault();void applyZoom(pinchZoom(pinchStart.zoom,pinchStart.distance,distance(),range()));}
  }
  function up(event){pointers.delete(event.pointerId);if(pointers.size<2)pinchStart=null;}
  // iOS Safari zooms the page on pinch even with touch-action set; these stop it
  // while the scanner is open. Ctrl+wheel is the desktop/trackpad pinch.
  const block=event=>event.preventDefault();
  const touch=event=>{if(event.touches.length>1)event.preventDefault();};
  const wheel=event=>{if(!event.ctrlKey)return;event.preventDefault();void applyZoom(pinchZoom(zoom,100,100-event.deltaY,range()));};
  const view=video.parentElement;
  view.addEventListener('pointerdown',down);view.addEventListener('pointermove',move);
  for(const type of ['pointerup','pointercancel','pointerleave'])view.addEventListener(type,up);
  root.addEventListener('touchmove',touch,{passive:false});root.addEventListener('wheel',wheel,{passive:false});
  for(const type of ['gesturestart','gesturechange','gestureend'])root.addEventListener(type,block);
  zoomButton.addEventListener('click',()=>void applyZoom(nextZoomStep(zoom,range())));
  torchButton.addEventListener('click',()=>void setTorch(!torchOn));

  // While open, cap page zoom at 1 so the scanner can't sit half zoomed; restored on close.
  const viewport=document.querySelector('meta[name=viewport]');let savedViewport=null;
  return {
    async attach(stream){
      track=stream?.getVideoTracks?.()[0]||null;features=cameraFeatures(track);zoom=features.zoom?Math.max(features.zoom.min,1):1;torchOn=false;
      root.style.setProperty('--vin-zoom','1');showZoom();
      torchButton.hidden=!features.torch;torchButton.setAttribute('aria-pressed','false');torchButton.classList.remove('on');torchButton.querySelector('.vin-cam-label').textContent='Light';
      if(features.focus)try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch{}
    },
    detach(){track=null;torchOn=false;pointers.clear();pinchStart=null;root.style.setProperty('--vin-zoom','1');},
    lockPage(locked){
      if(!viewport)return;
      if(locked&&savedViewport===null){savedViewport=viewport.content;viewport.content=savedViewport.replace(/,?\s*(maximum-scale|user-scalable)=[^,]*/g,'')+',maximum-scale=1,user-scalable=no';}
      else if(!locked&&savedViewport!==null){viewport.content=savedViewport;savedViewport=null;}
    },
    region(){
      if(!video.videoWidth)return null;
      // The band across the whole visible width at the guide's height: barcode ends
      // often stick out past the box, and a cut-off barcode cannot be read.
      const box=guide.getBoundingClientRect(),screen=root.getBoundingClientRect();
      return guideRegion(video.getBoundingClientRect(),{width:video.videoWidth,height:video.videoHeight},{left:screen.left,width:screen.width,top:box.top-box.height*.4,height:box.height*1.8},0);
    },
    get zoom(){return zoom;},get torch(){return torchOn;},get features(){return features;}
  };
}
