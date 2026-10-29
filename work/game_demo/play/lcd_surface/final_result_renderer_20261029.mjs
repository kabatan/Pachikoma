// Approved result v2: CRF8 native stage video, original glyphs and lossless half-float FX.
// Runtime values are drawn with the same 30fps source formulas in linear light.
const W=1152,H=1268, SCL=265/257, PITCH=300*SCL;
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const pop=(t,a)=>t>=0&&t<a.length?a[t]:1;
const CH=[2.4,1.55,1.12,.93,1.04,1], MID=[1.20,.96,1.03,1], LAST=[1.85,1.38,.92,1.08,.98,1];

export async function createFinalResultRenderer(base,man,video){
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Native result compositor requires float render targets');
 gl.getExtension('OES_texture_float_linear');
 const programs=[],textures=[],fbos=[],locations=new Map();
 const vert=`#version 300 es\nlayout(location=0) in vec2 p;out vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0,1);}`;
 const prog=body=>{const p=gl.createProgram();for(const [type,src] of [[gl.VERTEX_SHADER,vert],[gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;in vec2 uv;out vec4 o;${body}`]]){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));const uniforms=Object.create(null);for(const m of body.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const name of m[1].split(','))uniforms[name.trim()]=gl.getUniformLocation(p,name.trim());locations.set(p,uniforms);programs.push(p);return p;};
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
 const tex=(w,h,data=null,html=false,rgb=false)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(html)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,data);else gl.texImage2D(gl.TEXTURE_2D,0,rgb?gl.RGB16F:gl.RGBA16F,w,h,0,rgb?gl.RGB:gl.RGBA,gl.HALF_FLOAT,data);return {t,w,h};};
 const target=(w=W,h=H)=>{const t=tex(w,h),f=gl.createFramebuffer();fbos.push(f);gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.t,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Result framebuffer incomplete');return {...t,f};};
 const use=(p,out,inputs={},values={},rect=null)=>{gl.bindFramebuffer(gl.FRAMEBUFFER,out?.f??null);gl.viewport(...(rect??[0,0,out?.w??W,out?.h??H]));gl.useProgram(p);const loc=locations.get(p);let i=0;for(const [k,t] of Object.entries(inputs)){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t.t);gl.uniform1i(loc[k],i++);}for(const [k,v]of Object.entries(values)){const l=loc[k];if(Array.isArray(v))gl[`uniform${v.length}fv`](l,v);else gl.uniform1f(l,v);}gl.drawArrays(gl.TRIANGLE_STRIP,0,4);};
 const clear=out=>{gl.bindFramebuffer(gl.FRAMEBUFFER,out.f);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);};
 const drawP=prog(`uniform sampler2D im;uniform float gammaIn,opacity,mask,boost,rgbGain;void main(){vec4 c=texture(im,uv);if(gammaIn==1.)c.rgb=pow(max(c.rgb,vec3(0)),vec3(2.2))*c.a;else if(gammaIn==2.)c.rgb*=c.a;float m=mask>0.?clamp((175.*${SCL} -abs((uv.y-.5)*mask))/(25.*${SCL}),0.,1.):1.;o=c*(opacity*m);o.a=clamp(o.a*boost,0.,1.);o.rgb*=boost*rgbGain;}`);
 let letterBounds=null;
 const draw=(im,out,cx,cy,sx=1,sy=sx,opacity=1,gammaIn=1,mask=0,boost=1,rgbGain=1)=>{gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);const w=Math.max(1,Math.round(im.w*sx)),h=Math.max(1,Math.round(im.h*sy));const x=Math.round(cx-w/2),y=Math.round(cy-h/2);if(out===L){const b=[Math.max(0,x),Math.max(0,y),Math.min(W,x+w),Math.min(H,y+h)];if(b[2]>b[0]&&b[3]>b[1])letterBounds=letterBounds?[Math.min(letterBounds[0],b[0]),Math.min(letterBounds[1],b[1]),Math.max(letterBounds[2],b[2]),Math.max(letterBounds[3],b[3])]:b;}use(drawP,out,{im},{gammaIn,opacity,mask,boost,rgbGain},[x,y,w,h]);gl.disable(gl.BLEND);};
 const filterP=prog(`uniform sampler2D im;uniform vec2 stepUV;uniform float sigma,box;void main(){vec4 s=texture(im,uv);float total=1.;int r=int(box>0.?box:ceil(4.*sigma));for(int i=1;i<=144;i+=2){if(i>r)break;float a=box>0.?1.:exp(-.5*pow(float(i)/sigma,2.));float b=i+1>r?0.:(box>0.?1.:exp(-.5*pow(float(i+1)/sigma,2.)));float w=a+b;float d=(float(i)*a+float(i+1)*b)/w;s+=(texture(im,uv+stepUV*d)+texture(im,uv-stepUV*d))*w;total+=2.*w;}o=s/total;}`);
 const blur=(src,tmp,out,sigma)=>{
  // Only letter targets have a known exact zero exterior. Keep the full-size
  // textures, original UVs and every filter tap; skip solely guaranteed zeros.
  if(src===L){
   clear(tmp);clear(out);if(!letterBounds)return;
   const r=Math.ceil(4*sigma)+2,[x0,y0,x1,y1]=letterBounds,left=Math.max(0,x0-r),right=Math.min(W,x1+r),bottom=Math.max(0,y0-r),top=Math.min(H,y1+r);
   gl.enable(gl.SCISSOR_TEST);gl.scissor(left,Math.max(0,y0-2),right-left,Math.min(H,y1+2)-Math.max(0,y0-2));use(filterP,tmp,{im:src},{stepUV:[1/src.w,0],sigma,box:0});
   gl.scissor(left,bottom,right-left,top-bottom);use(filterP,out,{im:tmp},{stepUV:[0,1/src.h],sigma,box:0});gl.disable(gl.SCISSOR_TEST);
  }else{use(filterP,tmp,{im:src},{stepUV:[1/src.w,0],sigma,box:0});use(filterP,out,{im:tmp},{stepUV:[0,1/src.h],sigma,box:0});}
 };
 const composeP=prog(`uniform sampler2D bg,letters,shadow,glow,post;uniform float gain,f,isFail,nd;void main(){vec3 b=pow(texture(bg,uv).rgb,vec3(2.2));vec4 l=texture(letters,uv);float sh=texture(shadow,uv-vec2(4.,10.)/vec2(1152,1268)).a;b*=1.-(isFail>.5?.65:.6)*sh;vec3 g=texture(glow,uv).rgb;b+=g*(isFail>.5?vec3(.45,.55,.9)*.18:vec3(1.,.3,.12)*gain);b=b*(1.-l.a)+l.rgb;
 if(isFail<.5){float t=f-156.;if(t>=3.&&t<24.){float sx=mix(-200.,1452.,(t-3.)/21.);float band=pow(clamp(1.-abs((uv.x*1152.+uv.y*1268.*.4-sx)/46.),0.,1.),2.);b+=band*l.a*vec3(1.,.9,.8)*.30;}
 vec4 p=texture(post,uv);b=b*p.a+p.rgb;
 for(int k=1;k<5;k++){float lk=156.-2.*float(k);if(float(k)<nd&&f>=lk&&f<lk+3.){vec2 d=(uv*vec2(1152,1268)-vec2(197.+float(4-k)*164.,787.5))/vec2(80,130);b+=exp(-dot(d,d)/2.)*vec3(1.,.8,.4)*.22*(1.-(f-lk)/3.);}}}
 o=vec4(b,1);}`);
 const warpP=prog(`uniform sampler2D im;uniform vec2 shift;uniform float zoom;void main(){vec2 p=(uv*vec2(1152,1268)-vec2(576,634)-shift)/zoom+vec2(576,634);o=texture(im,p/vec2(1152,1268));}`);
 const hiP=prog(`uniform sampler2D im;void main(){o=vec4(max(texture(im,uv).rgb-vec3(.92),vec3(0)),1);}`);
 const finalP=prog(`uniform sampler2D im,b10,b36;void main(){vec2 v=uv;vec3 c=texture(im,v).rgb+(texture(b10,v).rgb*.6+texture(b36,v).rgb*.9)*.18;o=vec4(pow(clamp(c,0.,1.),vec3(1./2.2)),1);}`);
 const L=target(),tmp=target(),shadow=target(),glow=target(),image=target(),warped=target(),hi=target(),b10=target(),b36=target();
 const slot=target(244,Math.floor(760*SCL)),slotBlur=target(244,Math.floor(760*SCL));
 const atlas={},part={};
 const load=async(path,logicalScale=1)=>{const response=await fetch(new URL(path,base));if(!response.ok)throw Error(`result PNG ${response.status}: ${path}`);const b=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});const t=tex(b.width,b.height,b,true);b.close();t.w*=logicalScale;t.h*=logicalScale;return t;};
 // Exact v30 masters/placement. No synthetic browser font is used.
 for(const n of [...'0123456789'].map(d=>'d'+d).concat(['total','tama']))atlas[n]=await load(man.totalParts+'/'+n+'.png');
 for(const [n,scale] of Object.entries(man.parts))part[n]=await load('parts/'+n+'.png',scale);
 const upa=await load(man.upa),bubbles=await(await fetch(new URL('bubbles.json',base))).json();
 const effects=new Map(),fxRows=await(await fetch(new URL('fx.json',base))).json();
 // Lossless half-float sparse post layers; allocated only for the active scene.
 // Fetching does not block startup: counting/ending is the prewarm window.
 let prewarming=null;
 const prewarm=()=>prewarming??=(async()=>{for(const r of fxRows){const response=await fetch(new URL(r.file,base));if(!response.ok)throw Error(`result FX ${response.status}`);const raw=await new Response(response.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();const rgb=new Uint16Array(raw),rgba=new Uint16Array(r.w*r.h*4);for(let i=0,j=0;i<rgb.length;i+=3,j+=4){rgba[j]=rgb[i];rgba[j+1]=rgb[i+1];rgba[j+2]=rgb[i+2];}effects.set(r.kind+':'+r.f,{...r,data:rgba});}})();
 const bgTex=tex(W,H),postTex=target(),stage=target(),rA=target(),rB=target(),fx=target(),fxTmp=target(),fxBlur=target();let current=rA,other=rB,lastKey=null,disposed=false;
 const passthrough=prog(`uniform sampler2D im;void main(){o=texture(im,vec2(uv.x,1.-uv.y));}`);
 const copyP=prog(`uniform sampler2D im;void main(){o=texture(im,uv);}`);
 const fieldP=prog(`uniform vec2 center;uniform float size,kind,amount;uniform vec3 color;void main(){vec2 d=gl_FragCoord.xy-center;float g;if(kind>.5){g=exp(-pow(d.x/(size*.07),2.)-pow(d.y/(size*.9),2.))+exp(-pow(d.y/(size*.07),2.)-pow(d.x/(size*.9),2.))+1.2*exp(-dot(d,d)/pow(size*.22,2.));}else g=exp(-dot(d,d)/(2.*size*size));o=vec4(color*g*amount,0);}`);
 const ringP=prog(`uniform vec2 center;uniform float radius,fall;void main(){float d=distance(gl_FragCoord.xy,center);o=vec4(exp(-pow((d-radius)/14.,2.))*.5*fall*vec3(.5,.8,1.),0);}`);
 const underP=prog(`uniform sampler2D im,shadow;uniform float hush,frameAlpha,shade;void main(){vec3 c=texture(im,uv).rgb*(1.-.35*hush);c*=1.-texture(shadow,uv).a*.39*frameAlpha;vec2 p=gl_FragCoord.xy;float mask=clamp((erf((p.x-80.)/36.77)-erf((p.x-1000.)/36.77))*.5,0.,1.)*clamp((erf((p.y-930.)/36.77)-erf((p.y-1200.)/36.77))*.5,0.,1.);o=vec4(c*(1.-.30*mask*shade),1);}`.replace('void main()',`float erf(float x){float a=abs(x),t=1./(1.+.3275911*a);return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a));}void main()`));
 // The lower dark mat is applied after the gold frame, as in frame_img.
 const lowerP=prog(`uniform sampler2D im;uniform float opacity;void main(){vec2 p=gl_FragCoord.xy;float m=(erf((p.x-80.)/36.77)-erf((p.x-1000.)/36.77))*.5*(erf((p.y-930.)/36.77)-erf((p.y-1200.)/36.77))*.5;o=vec4(texture(im,uv).rgb*(1.-.30*m*opacity),1);}`.replace('void main()',`float erf(float x){float a=abs(x),t=1./(1.+.3275911*a);return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a));}void main()`));
 const frameP=prog(`uniform sampler2D im;uniform float opacity,bandX,bandOn;void main(){vec4 c=texture(im,uv);float band=pow(clamp(1.-abs((uv.x*1152.+uv.y*1268.*.7-bandX)/70.),0.,1.),2.)*bandOn;c.rgb=clamp(c.rgb+band*.8*vec3(1.,.92,.7),0.,1.5);o=vec4(c.rgb*c.a*opacity,c.a*opacity);}`);
 const liquidP=prog(`uniform float width,frame,opacity;void main(){vec2 p=gl_FragCoord.xy;float v=(p.y-1022.)/17.,u=(p.x-140.)/max(1.,width-1.);float prof=.62+.55*sqrt(clamp(1.-v*v,0.,1.));vec3 c=vec3(1.,.40+.35*u,.08+.25*u)*prof;float hl=exp(-pow((v+.5)/.18,2.))*.6;float shine=exp(-pow((p.x-140.-(mod(frame*9.,400.)-100.))/26.,2.))*.5*prof;float m=clamp((17.-abs(p.y-1022.))/1.6,0.,1.)*clamp((p.x-140.+.5)/2.,0.,1.)*opacity;o=vec4(clamp(c+hl+shine,0.,1.4)*m,m);}`);
 const rayP=prog(`uniform float frame;void main(){vec2 d=gl_FragCoord.xy-vec2(576,296);float a=atan(d.y,d.x),rot=frame*.012;float r=pow(.5+.5*cos(a*14.+rot*6.),3.)*(.5+.5*cos(a*5.-rot*4.));o=vec4(vec3(r),1);}`);
 const medalLightP=prog(`uniform sampler2D im,rays;uniform float frame,rankS;void main(){vec3 c=texture(im,uv).rgb;float t=frame-214.,r=distance(gl_FragCoord.xy,vec2(576,296));float k=clamp(t/6.,0.,1.);k=k*k*(3.-2.*k);c+=texture(rays,uv).rgb*exp(-pow(r/360.,2.))*k*(rankS>.5?.45:.30)*vec3(.5,.8,1.);c+=exp(-pow(r/230.,2.))*k*.22*vec3(.45,.75,1.);float fl=t==0.?.8:t==1.?.5:t==2.?.28:t==3.?.12:t==4.?.05:0.;c=c*(1.-fl)+fl;if(t<16.)c+=exp(-pow((r-(50.+52.*t))/(18.+4.*t),2.))*exp(-t*.2)*.7*vec3(.5,.85,1.);o=vec4(c,1);}`);
 const medalSweepP=prog(`uniform sampler2D im,mask;uniform float bandX;void main(){vec2 p=gl_FragCoord.xy;vec2 v=(p-vec2(576,296))/302.4+.5;float a=all(greaterThanEqual(v,vec2(0)))&&all(lessThanEqual(v,vec2(1)))?texture(mask,v).a:0.;float band=pow(clamp(1.-abs((p.x+p.y*.6-bandX)/36.),0.,1.),2.);o=vec4(texture(im,uv).rgb+band*a*.5,1);}`);
 const sparksP=prog(`uniform sampler2D im,add;uniform float gammaMode;void main(){vec3 c=texture(im,uv).rgb;vec3 a=texture(add,uv).rgb;if(gammaMode>.5)c=pow(clamp(pow(clamp(c,0.,1.5),vec3(2.2))+a,0.,1.5),vec3(1./2.2));else c+=a;o=vec4(c,1);}`);
 const clampP=prog(`uniform sampler2D im;void main(){o=vec4(clamp(texture(im,uv).rgb,0.,1.),1);}`);
 const step=(p,inputs={},values={})=>{use(p,other,{im:current,...inputs},values);[current,other]=[other,current];};
 const blend=(p,values,rect,inputs={})=>{gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);use(p,current,inputs,values,rect);gl.disable(gl.BLEND);};
 const sprite=(name,x,y,s=1,a=1,sy=s,tint=1)=>draw(part[name],current,x,y,s,sy,a,2,0,1,tint);
 const addField=(x,y,r,k,col,kind)=>{if(k<=0)return;const extent=Math.ceil(r*(kind?1.6:3));const x0=Math.max(0,Math.floor(x-extent)),y0=Math.max(0,Math.floor(y-extent)),x1=Math.min(W,Math.floor(x+extent)),y1=Math.min(H,Math.floor(y+extent));if(x1<=x0||y1<=y0)return;gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);use(fieldP,current,{}, {center:[x,y],size:r,amount:k,color:col,kind},[x0,y0,x1-x0,y1-y0]);gl.disable(gl.BLEND);};
 const glint=(x,y,size,k)=>addField(x,y,size,k,[.8,.95,1],1);
 const blob=(x,y,r,col,k)=>addField(x,y,r,k,col,0);
 const applyFx=(kind,f)=>{const r=effects.get(kind+':'+f);clear(fx);if(r){gl.bindTexture(gl.TEXTURE_2D,fx.t);gl.texSubImage2D(gl.TEXTURE_2D,0,r.x,r.y,r.w,r.h,gl.RGBA,gl.HALF_FLOAT,r.data);}return r;};
 function totalDigits(f,V){letterBounds=null;clear(L);if(f<96)return;const t=f-96,u=t/5,s=u<1?1.5-.5*ease(u):1,op=Math.min(1,u*3),P=(x,y)=>[576+(x-576)*s,780+(y-780)*s];const put=(n,x,y,sc=s)=>draw(atlas[n],L,x,y,sc,sc,op);put('total',...P(290.5,613.5));
  const str=String(Math.min(99999,V)).padStart(5,'0'),nd=String(V).length;
  for(let j=0;j<5;j++){const k=4-j,cx=197+j*164,cy=787.5,lk=k>=nd?-1:156-2*k,locked=lk<0||f>=lk;const sc=locked&&lk>=0?pop(f-lk,k===0?LAST:MID):1;
   if(locked||f<102){put('d'+(locked?str[j]:'0'),...P(cx,cy),s*sc);continue;}
   const count=t=>{const u=Math.max(0,Math.min(1,(t-102)/54));return V*(1-(1-u)**1.7);},odo=(v,k)=>k===0?v:Math.floor(v/10**k)+Math.max(0,Math.min(1,(v/10**(k-1))%10-9));const q=odo(count(f),k),dq=Math.abs(q-odo(count(f-1),k)),fl=Math.floor(q),fr=q-fl;clear(slot);for(let jj=-2;jj<=2;jj++)draw(atlas['d'+((fl+jj)%10+10)%10],slot,122,slot.h/2+(jj-fr)*PITCH);const len=Math.min(dq,1)*PITCH*.62;let input=slot;if(len>3){use(filterP,slotBlur,{im:slot},{stepUV:[0,1/slot.h],sigma:1,box:Math.floor((Math.floor(len)|1)/2)});input=slotBlur;}draw(input,L,...P(cx,cy),s,s,op,0,slot.h,len>3?1+1.5*Math.min(1,dq):1);
  }put('tama',...P(991,859));
 }
 function baseFrame(f,V){totalDigits(f,V);blur(L,tmp,shadow,14);blur(L,tmp,glow,22);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,bgTex.t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
  clear(postTex);const tl=f-156,fl=tl>=0&&tl<4?[.55,.32,.16,.07][tl]:0;
  gl.bindFramebuffer(gl.FRAMEBUFFER,postTex.f);gl.clearBufferfv(gl.COLOR,0,new Float32Array([fl,fl*.92,fl*.75,1-fl]));
  if(applyFx('total',f)){gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);use(copyP,postTex,{im:fx});gl.disable(gl.BLEND);}
  const spin=f>=102&&f<156?.6+.6*(f-102)/54:0,gain=.32+.12*spin+(tl>=0?1.4*Math.exp(-tl*.14):0);use(composeP,image,{bg:bgTex,letters:L,shadow,glow,post:postTex},{gain,f,isFail:0,nd:String(V).length});
  let sh=0,zoom=1;if(tl>=0&&tl<14){sh=40*(1-tl/16);zoom=1+.1*Math.exp(-tl*.42);}if(f>=108&&f<156)sh=Math.max(sh,2+3*((f-102)/54)**2);if(f>=147&&f<156)zoom=1+.03*ease((f-147)/9);use(warpP,warped,{im:image},{shift:[sh*Math.sin(f*2.3),sh*Math.cos(f*3.1)],zoom});use(hiP,hi,{im:warped});blur(hi,tmp,b10,10);blur(hi,tmp,b36,36);use(finalP,stage,{im:warped,b10,b36});use(copyP,rA,{im:stage});current=rA;other=rB;
 }
 const ranks='NCBAS',slam=[2.7,1.75,1.18,.90,1.07,.98,1],popChip=[1.6,1.25,.95,1.05,1],popMsg=[1.8,1.35,1.08,.96,1.04,1];
 function smallDigits(num,cx,cy,sc,a,pitch=66,unit=null){const str=String(num),wid=pitch*sc*str.length+(unit?80*sc:0);let x=cx-wid/2+pitch*sc/2;for(const ch of str){sprite('sn'+ch,x,cy,sc,a);x+=pitch*sc;}if(unit)sprite('lb_'+unit,x+10*sc,cy+4*sc,.85*sc,a);}
 function chip(f,t0,cx,label,num,unit,flash=false){let t=f-t0;if(t<0)return;const s=pop(t,popChip),a=Math.min(1,(t+1)/2);sprite('lb_'+label,cx,240,s,a);const fit=String(num).length<=3?1:Math.min(1,367.2/(1.35*(64*String(num).length+80)));smallDigits(num,cx,318,1.35*s*fit,a,64,unit);if(flash&&Math.floor(f/5)%2===0)glint(cx,300,90,.8*a);}
 function meter(f,state){if(f<160)return;const {value:V,thresholds:th,rankIndex}=state,t=f-160,a=Math.min(1,t/6),rise=(1-ease(t/8))*40,xs=v=>140+720*v/th[4],speed=18,xt=xs(Math.min(V,th[4])),end=168+(xt-140)/speed,near=rankIndex<4;let xf=f>=168?140+Math.max(0,Math.min(xt-140,(f-168)*speed)):140;if(f>=end&&near)xf=xt+3*Math.sin((f-end)*1.7)*Math.exp(-(f-end)*.07);sprite('trough',500,1022+rise,1,a);
  const w=Math.floor(Math.max(0,xf-140));if(w>2){blend(liquidP,{width:w,frame:f,opacity:a},[140,1005,w,35]);blob(xf,1022,22,[.55,.85,1],.55*a);blob(xf,1022,60,[.4,.7,1],.18*a);if(f>=168&&f<end+2)glint(xf,1022,70,.9);}
  const next=state.nextIndex;
  for(let k=1;k<5;k++){const mark=state.meterSteps[k-1],x=mark.x,fit=mark.scale/.19,passed=k<=rankIndex&&V>=th[k],tp=168+(x-140)/speed,lit=passed&&f>=tp;let s=.19*fit,dim=.30,yy=957+rise;
   if(lit){const tt=f-tp;s*=pop(Math.floor(tt),[1.9,1.5,1.2,.95,1.08,1]);dim=1;if(tt>=0&&tt<14)glint(x,957,90,(1-tt/14));if(tt>=0&&tt<10){gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);use(ringP,current,{}, {center:[x,965],radius:12*tt,fall:1-tt/10});gl.disable(gl.BLEND);}blob(x,1022,14,[1,.8,.3],.9*a);}else{blob(x,1022,9,[1,.7,.2],.35*a);s=.18*fit;}
   if(k===next&&f>=end+4&&near){const blink=.5+.5*Math.sin((f-end)*.55);s*=1+.10*blink;blob(x,960,46,[1,.85,.4],.7*blink*a);blob(x,1022,20,[1,.9,.5],.9*blink*a);if(Math.floor((f-end)/6)%2===0)glint(x,957,80,.6);}
   sprite('medal_'+ranks[k],x,yy,s,a*(lit?1:.85),s,dim);
  }
 }
 function render(f,state){if(disposed||video.readyState<2)return null;f=Math.max(0,Math.floor(f));const {value:V,rankIndex,jp,best,newRecord}=state,rank=ranks[rankIndex];const key=f+':'+JSON.stringify(state);if(key===lastKey)return canvas;lastKey=key;baseFrame(f,Math.min(99999,V));
  const u=(f-40)/12,fa=f>=40?Math.min(1,u*1.6):0,hush=ease((f-206)/8)*(1-ease((f-214)/4));step(underP,{shadow:part.frame_shadow},{hush,frameAlpha:fa,shade:0});
  if(f>=40){const s=1+.10*(1-ease(u)),t=(f-52)%54;blend(frameP,{opacity:fa,bandX:-300+(W+800)*t/22,bandOn:f>=52&&t<22?1:0},[Math.round(W/2-W*s/2),Math.round(H/2-H*s/2),Math.round(W*s),Math.round(H*s)],{im:part.frame_gold});const points=[[60,60],[575,55],[1090,60],[62,1212],[1090,1212],[100,640],[1052,640]];for(let i=0;i<points.length;i++){const [x,y]=points[i],ph=((f-40)*.9+i*17)%50;glint(576+(x-576)*1.06,634+(y-634)*1.06,46+10*(i%3),Math.max(0,1-Math.abs(ph-8)/8)*fa*.9);}}
  if(f>=160)step(lowerP,{}, {opacity:ease((f-160)/8)});meter(f,state);
  const tm=f-214;if(tm>=0){use(rayP,fx,{}, {frame:f});blur(fx,fxTmp,fxBlur,6);step(medalLightP,{rays:fxBlur},{frame:f,rankS:rank==='S'?1:0});const s=pop(tm,slam)*.72*(tm>20?1+.012*Math.sin(f*.15):1);sprite('medal_shadow_'+rank,584,310,s,.6);sprite('medal_'+rank,576,296,s);const t2=(tm-8)%48;if(tm>=8&&t2<20)step(medalSweepP,{mask:part['medal_'+rank]},{bandX:296+610*t2/20});for(const [dx,dy,ph]of [[-130,-100,0],[120,-120,17],[150,80,31],[-150,90,44]])glint(576+dx,296+dy,56,Math.max(0,1-Math.abs(((tm+ph)%56)-6)/6)*ease(tm/8));const tp=tm-7;if(tp>=0){const sp=pop(tp,[1.6,1.25,1,1.05,1]),a=Math.min(1,(tp+1)/2);sprite('plaque_shadow_'+rank,584,490,sp,.55*a);sprite('plaque_'+rank,576,482,sp,a);}if(tm<28&&applyFx('medal',f))step(sparksP,{add:fx},{gammaMode:1});}
  chip(f,222,245,newRecord?'new':'best',newRecord?V:best,'tama',newRecord);chip(f,230,905,'jp',jp,'kai');
  const mk=f>=292?Math.max(0,1-(f-292)/8):1,tmg=f-228;if(tmg>=0&&mk>0){const s=pop(tmg,popMsg),a=Math.min(1,(tmg+1)/2)*mk,yo=(1-mk)*-30;if(rankIndex<4){const y=1108+yo,nk=state.nextIndex,need=state.need,sc=1.3,pitch=66*sc,tot=330+124+pitch*String(need).length+130;let x=490-tot/2;const put=(nm,cx,cy,scale)=>sprite(nm,490+(cx-490)*s,y+(cy-y)*s,scale*s,a);if(state.dreamRequired){put('lb_dream',490,y,1);}else{put('lb_nx_'+ranks[nk],x+165,y,1);x+=330;put('lb_ato',x+68,y+6,1);x+=124;for(const ch of String(need)){put('sn'+ch,x+pitch/2,y-2,sc);x+=pitch;}put('lb_tama',x+36,y+10,1.1);put('lb_excl',x+92,y,.95);}if(tmg<5)glint(490,y,170,.7*(1-tmg/5));}else{sprite('lb_top',490,1115+yo,1.25*s,a);if(tmg<20)blob(490,1115,160,[1,.8,.3],.5*(1-tmg/20)*a);for(const [dx,dy,ph]of [[-260,-20,0],[250,10,16],[-110,30,33],[140,-30,46]])glint(490+dx,1115+dy,50,Math.max(0,1-Math.abs(((tmg+ph)%56)-6)/6));}}
  if(f>=292){const tc=f-292,s=pop(tc,popMsg),a=Math.min(1,(tc+1)/3),pul=1+.035*Math.sin(tc*.45);sprite('lb_retry',560,1108,.98*s*pul,a);sprite('lb_arrow',190-14*Math.abs(Math.sin(tc*.3)),1108,s,a);if(tc<5)glint(560,1108,150,.7*(1-tc/5));}
  if(f>=220){const ph=((f-228)%40+40)%40,hop=ph<14?18*Math.sin(ph/14*Math.PI):0,enter=(1-ease((f-220)/8))*240;gl.bindTexture(gl.TEXTURE_2D,upa.t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);draw(upa,current,165,1206-upa.h*1.5-hop+enter,3,3,1,2);}
  if(f>=214)for(let i=0;i<bubbles.length;i++){const [bx,sp,r,ph]=bubbles[i],by=1240-((ph+(f-214)*sp*3)%1200),x=bx+14*Math.sin((f+i*30)*.05);if(by>130&&by<1200)blob(x,by,r,[.75,.9,1],.16);}
  step(clampP);use(passthrough,null,{im:current});canvas.resultRevision=(canvas.resultRevision??0)+1;return canvas;
 }
 return {canvas,prewarm,render,get ready(){return effects.size===fxRows.length;},dispose(){disposed=true;for(const t of textures)gl.deleteTexture(t);for(const f of fbos)gl.deleteFramebuffer(f);for(const p of programs)gl.deleteProgram(p);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);effects.clear();}};
}
