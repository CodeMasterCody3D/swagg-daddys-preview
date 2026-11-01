(() => {
  const media=document.getElementById('media'), list=document.getElementById('file-list');
  const camera=document.getElementById('media-camera');
  document.getElementById('media-camera-button').addEventListener('click',()=>camera.click());
  camera.addEventListener('change',()=>{
    const photo=camera.files[0];
    if(!photo)return;
    const selection=new DataTransfer();
    for(const file of media.files)selection.items.add(file);
    selection.items.add(photo);
    media.files=selection.files;
    camera.value='';
    media.dispatchEvent(new Event('change',{bubbles:true}));
  });
  let generation=0;
  window.SWAGG_MEDIA_READY=Promise.resolve({files:[],warnings:[]});
  async function browserPhoto(file,budget) {
    const url=URL.createObjectURL(file),image=new Image();
    try {
      if(file.size>25*1024*1024)throw new Error('Choose a photo under 25 MB.');
      image.src=url;await image.decode();
      // Preserve small images already supported by the private attachment service.
      if(['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)&&file.size<=budget)return file;
      const canvas=document.createElement('canvas');let scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
      for(let attempt=0;attempt<4;attempt++) {
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85-attempt*.12));
        if(blob&&blob.size<=budget)return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
        scale*=.65;
      }
      throw new Error('Image is too large to prepare.');
    } finally {URL.revokeObjectURL(url);}
  }
  async function prepare(files) {
    const prepared=[],warnings=[],optimized=[];let remaining=4*1024*1024,videos=0;
    if(files.length>3)warnings.push('Only the first 3 selected files will be included.');
    for(const [i,file] of files.slice(0,3).entries()) {
      const video=file.type.startsWith('video/')||/\.(mp4|mov|webm)$/i.test(file.name);
      try {
        let ready;
        if(video) {
          if(videos||file.size>remaining)throw new Error('Video exceeds the attachment allowance.');
          ready=file;videos++;
        } else ready=await browserPhoto(file,Math.max(50000,Math.floor(remaining/(Math.min(files.length,3)-i))));
        if(ready.size>remaining)throw new Error('Attachment allowance exceeded.');
        prepared.push(ready);remaining-=ready.size;if(ready!==file)optimized.push(file.name);
      } catch {warnings.push(file.name+(file.size>25*1024*1024?' is over the 25 MB photo limit and was not attached.':' could not be prepared and was not attached.')+' You can still send the request and share this file with the mechanic later.');}
    }
    return {files:prepared,warnings,optimized,sourceBytes:files.slice(0,3).reduce((sum,file)=>sum+file.size,0)};
  }
  media.addEventListener('change',()=>{
    const current=++generation;const files=[...media.files];list.textContent=files.length?'Preparing your photos…':'No files selected.';
    window.SWAGG_MEDIA_READY=prepare(files).then(result=>{if(current===generation)list.textContent=[result.files.length?result.files.map(f=>f.name).join(' • '):'No files attached.',result.optimized.length?'Photos optimized automatically: '+(result.sourceBytes/1024/1024).toFixed(1)+' MB selected → '+(result.files.reduce((sum,file)=>sum+file.size,0)/1024/1024).toFixed(1)+' MB ready to send.':'',...result.warnings].join(' ');return result;});
  });
  document.getElementById('service-form').addEventListener('reset',()=>{generation++;camera.value='';window.SWAGG_MEDIA_READY=Promise.resolve({files:[],warnings:[]});list.textContent='No files selected.';});
})();
