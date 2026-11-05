import { mountVinScanner } from './vin-controller.js';
const scanner=mountVinScanner();
document.getElementById('hero-vin-scan')?.addEventListener('click',()=>scanner.open());
