/* Stand-ins for the CDN libraries, following each library's public API.
   Used only when the real files cannot be downloaded in the test environment.
   e2e.py serves one of these per CDN URL (see LIB_STUBS there). */
module.exports = {
  marked: `window.marked={parse:s=>String(s).split(/\\n{2,}/).map(b=>/^#+ /.test(b)?'<h2>'+b.replace(/^#+ /,'')+'</h2>':/^<details>/.test(b)?b:'<p>'+b.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</p>').join('')};`,
  purify: `window.DOMPurify={sanitize:s=>String(s).replace(/<script[\\s\\S]*?<\\/script>/gi,'')};`,
  pdf: `window.pdfjsLib={GlobalWorkerOptions:{},getDocument:({data})=>({promise:Promise.resolve({numPages:2,getPage:async n=>({getTextContent:async()=>({items:[{str:'Página '+n+' del tema. '+'Contenido de estudio suficiente para no parecer escaneado. '.repeat(3),hasEOL:true}]}),getViewport:()=>({width:20,height:20}),render:()=>({promise:Promise.resolve()})})})})};`,
  pdfWorker: `window.pdfjsWorker={WorkerMessageHandler:{}};`,
  mammoth: `window.mammoth={extractRawText:async({arrayBuffer})=>{if(!arrayBuffer||!arrayBuffer.byteLength)throw new Error('empty');return{value:'Contenido del documento Word. Tema 2: la Segunda República.'};}};`,
  jszip: `window.JSZip={loadAsync:async()=>({files:{'ppt/slides/slide2.xml':{},'ppt/slides/slide1.xml':{},'ppt/media/x.png':{}},file:n=>({async:async()=>'<p:sld xmlns:p="p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Texto de </a:t><a:t>'+n+'</a:t></a:p></p:sld>'})})};`,
  pptx: `window.PptxGenJS=function(){const slides=[];this.ShapeType={rect:'rect'};this.addSlide=()=>{const s={items:[],addText(t,o){if(!o||o.x==null||o.y==null)throw new Error('addText needs position');if(Array.isArray(t)&&!t.every(r=>typeof r.text==='string'))throw new Error('bad runs');this.items.push(['t',t,o]);},addShape(sh,o){if(!sh||!o)throw new Error('addShape');this.items.push(['s',sh,o]);},addNotes(n){if(typeof n!=='string')throw new Error('notes');this.notes=n;}};slides.push(s);return s;};this.write=async p=>{if(!p||p.outputType!=='blob')throw new Error('write');window.__pptx=slides;return new Blob(['PK'+JSON.stringify(slides)]);};};`,
  html2pdf: `window.html2pdf=()=>{const w={set:()=>w,from:el=>{w.el=el;return w;},outputPdf:async t=>{if(t!=='blob')throw new Error('type');return new Blob(['%PDF-1.4 '+w.el.innerHTML.length],{type:'application/pdf'});}};return w;};`,
};
