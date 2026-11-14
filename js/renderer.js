// WebGL2-рендерер: PBR + мягкие тени (PCSS) + карта затенения неба + SSAO + суперсэмплинг.
import { M, V } from './glmath.js';

const NOISE = `
float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s/0.9375; }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }
`;

const VS_MAIN = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec4 a_nrm; layout(location=2) in vec4 a_col; layout(location=3) in vec4 a_mat;
uniform mat4 u_model, u_viewProj;
out vec3 v_wp, v_op, v_n; out vec4 v_col, v_mat; out float v_edge;
void main(){ vec4 w=u_model*vec4(a_pos,1.); v_wp=w.xyz; v_op=a_pos; v_n=mat3(u_model)*a_nrm.xyz; v_col=a_col; v_mat=a_mat; v_edge=a_nrm.w; gl_Position=u_viewProj*w; }`;

const FS_MAIN = `#version 300 es
precision highp float;
in vec3 v_wp, v_op, v_n; in vec4 v_col, v_mat; in float v_edge;
uniform vec3 u_cam, u_lightDir, u_lightCol, u_horizon;
uniform mat4 u_shadowMat, u_skyMat, u_view;
uniform highp sampler2D u_shadow, u_sky;
uniform float u_ground, u_shadowTexel, u_skyTexel, u_groupSeed;
layout(location=0) out vec4 o_amb; layout(location=1) out vec4 o_dir; layout(location=2) out vec4 o_nrm;
const float PI=3.14159265;
${NOISE}
vec2 vogel(int i, float n, float rot){ float r=sqrt((float(i)+0.5)/n), a=float(i)*2.39996323+rot; return r*vec2(cos(a),sin(a)); }

float shadowKey(vec3 wp, vec3 N, float rot){
  vec4 sp=u_shadowMat*vec4(wp+N*0.014,1.); vec3 c=sp.xyz*0.5+0.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.) return 1.;
  float zr=c.z-0.0006, sum=0., cnt=0.;
  for(int i=0;i<10;i++){ float zb=texture(u_shadow,c.xy+vogel(i,10.,rot)*u_shadowTexel*14.).r; if(zb<zr){ sum+=zb; cnt+=1.; } }
  if(cnt<0.5) return 1.;
  float pen=clamp((zr-sum/cnt)*340., 1.6, 16.)*u_shadowTexel;   // ширина полутени растёт с расстоянием до заслоняющего
  float s=0.;
  for(int i=0;i<20;i++){ s+=step(zr, texture(u_shadow,c.xy+vogel(i,20.,rot+1.7)*pen).r); }
  return s/20.;
}
// доля открытого неба над точкой (широкое размытие карты глубины «сверху») — контактные тени
float skyVis(vec3 wp, vec3 N, float rot){
  vec4 sp=u_skyMat*vec4(wp+N*0.03,1.); vec3 c=sp.xyz*0.5+0.5;
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.) return 1.;
  float zr=c.z-0.002, s=0.;
  for(int i=0;i<16;i++){
    vec2 o=vogel(i,16.,rot+0.9); float w=(i<8)?26.:9.;
    s+=step(zr, texture(u_sky,c.xy+o*u_skyTexel*w).r);
  }
  return s/16.;
}
float sbox(vec3 d, vec3 n, vec3 t, vec3 b2, vec2 hs, float soft){
  float dn=dot(d,n); if(dn<=0.02) return 0.;
  vec2 uv=vec2(dot(d,t),dot(d,b2))/dn;
  vec2 e=smoothstep(hs+soft, hs-soft, abs(uv));
  return e.x*e.y;
}
// процедурная «студия»: тёмный циклорама-фон, большой верхний софтбокс, боковые стрипы
vec3 envMap(vec3 d, float r){
  float s=0.06+r*0.9;
  vec3 c=mix(vec3(0.085,0.075,0.066), vec3(0.105,0.110,0.120), smoothstep(-0.3-s,0.3+s,d.y));
  c+=vec3(1.00,0.97,0.92)*2.6*sbox(d, vec3(0.,1.,0.), vec3(1.,0.,0.), vec3(0.,0.,1.), vec2(1.3,0.8), s*1.2)/(1.+2.*r);
  c+=vec3(0.80,0.88,1.00)*1.9*sbox(d, normalize(vec3(-0.75,0.25,-0.6)), normalize(vec3(0.6,0.,-0.75)), vec3(0.,1.,0.), vec2(0.35,1.1), s)/(1.+2.*r);
  c+=vec3(1.00,0.93,0.84)*1.5*sbox(d, normalize(vec3(0.55,0.30,0.78)), normalize(vec3(0.78,0.,-0.55)), vec3(0.,1.,0.), vec2(0.9,0.6), s)/(1.+2.*r);
  c+=vec3(1.00,0.95,0.90)*1.2*sbox(d, normalize(vec3(0.5,0.2,-0.84)), normalize(vec3(0.84,0.,0.5)), vec3(0.,1.,0.), vec2(0.3,0.9), s)/(1.+2.*r);
  return c;
}
vec3 irradiance(vec3 n){
  vec3 c=mix(vec3(0.26,0.225,0.18), vec3(0.40,0.415,0.45), n.y*0.5+0.5);       // отсвет пола -> верхний софтбокс
  float t=max(n.y,0.); c+=vec3(0.14,0.135,0.125)*t*t;
  float f1=max(dot(n,normalize(vec3(-0.75,0.25,-0.6)))*0.6+0.4,0.); c+=vec3(0.26,0.30,0.36)*f1*f1;   // холодный контровой
  float f2=max(dot(n,normalize(vec3(0.5,0.2,-0.84)))*0.6+0.4,0.);  c+=vec3(0.24,0.225,0.20)*f2*f2;    // заполняющий
  float f3=max(dot(n,normalize(vec3(0.55,0.30,0.78)))*0.6+0.4,0.); c+=vec3(0.25,0.235,0.21)*f3*f3;
  return c*0.50;
}
void main(){
  vec3 V=normalize(u_cam-v_wp);
  vec3 N=normalize(v_n); if(dot(N,V)<0.) N=-N;
  vec3 Ng=N;
  vec3 base=pow(v_col.rgb, vec3(2.2));
  float rough=v_col.a, metal=v_mat.x, dustK=v_mat.y, bumpK=v_mat.z, glass=v_mat.w;
  vec3 op=v_op+u_groupSeed;
  float rot=ign(gl_FragCoord.xy)*6.2831853;
  float fadeOut=0.;
  if(u_ground>0.5){
    float fw0=length(fwidth(v_wp));
    float q2=clamp(1.2-fw0*14.,0.,1.), q3=clamp(1.2-fw0*160.,0.,1.);
    float g1=fbm(v_wp*vec3(0.7,1.,0.7)), g2=mix(0.5,fbm(v_wp*9.),q2), g3=mix(0.5,vnoise(v_wp*130.),q3);
    base=vec3(0.120,0.112,0.102)*(0.80+0.30*g1+0.14*g2+0.08*g3);
    rough=0.86+0.1*g2; metal=0.; glass=0.;
    float fw=fw0*90.;
    vec3 gb=vec3(vnoise(v_wp*90.)-.5,0.,vnoise(v_wp*90.+31.)-.5);
    N=normalize(N+gb*0.22*clamp(1.4-fw,0.,1.));
    fadeOut=smoothstep(5.,33.,length(v_wp.xz-vec2(0.6,0.)));
  } else {
    float n1=fbm(op*1.7), n2=fbm(op*7.3+5.), n3=vnoise(op*46.), n4=fbm(op*21.+9.);
    float upF=smoothstep(0.35,0.95,Ng.y);
    float paint=(1.-metal)*(1.-glass);
    // неоднородность краски: выгорание, разводы
    base*=0.74+0.36*n1+0.20*n2;
    base*=mix(1.,0.86+0.10*n3,upF*bumpK);
    base=mix(base, base*vec3(1.07,1.0,0.90), smoothstep(0.42,0.8,n2)*0.45*paint);
    // потёртые кромки: высветленная краска, местами до металла
    float wear=v_edge*smoothstep(0.30,0.62,n4+0.25*n3);
    base=mix(base, base*1.30+0.035, (0.30*v_edge+0.55*wear)*paint*step(0.2,dustK+bumpK-0.3));
    float bare=v_edge*smoothstep(0.66,0.80,n4)*paint*step(0.5,bumpK+0.6);
    base=mix(base, vec3(0.30,0.285,0.27), bare*0.85); metal=mix(metal,0.85,bare*0.8); rough=mix(rough,0.42,bare);
    // вертикальные потёки на бортах
    float streak=0.6*vnoise(vec3(op.x*23.,op.y*1.6,op.z*23.))+0.4*vnoise(vec3(op.x*61.,op.y*3.,op.z*61.));
    float st=(1.-upF)*smoothstep(0.50,0.80,streak)*paint*smoothstep(-0.2,0.5,-abs(Ng.y)+0.6)*bumpK;
    base*=1.-0.20*st;
    // грязь внизу и в углах (тёмная), пыль сверху (светлая)
    float low=smoothstep(1.6,0.15,v_wp.y);
    float grime=dustK*clamp(low*low*0.9+0.14,0.,1.)*smoothstep(0.30,0.70,0.5*n1+0.5*n2+0.3*low);
    base=mix(base, vec3(0.19,0.152,0.112)*(0.8+0.5*n2), grime*0.60);
    float dust=dustK*clamp(0.10+0.45*low+0.34*upF,0.,1.)*smoothstep(0.38,0.66,0.5*n1+0.4*n4+0.1*n3+0.12*upF);
    vec3 dustCol=vec3(0.375,0.32,0.245)*(0.85+0.3*n2);
    base=mix(base,dustCol,dust*0.80);
    float dirt=max(dust,grime);
    rough=mix(rough,0.97,dirt); metal*=1.-dirt*0.9; glass*=1.-dust*0.7;
    rough=clamp(rough+(n2-0.5)*0.12*(1.-glass),0.04,1.);
    // шероховатость: литьё/противоскользящее покрытие
    if(bumpK>0.01){
      float fw=length(fwidth(v_op));
      float k1=clamp(1.3-fw*150.,0.,1.), k2=clamp(1.3-fw*45.,0.,1.);
      vec3 g=vec3(vnoise(op*150.)-.5, vnoise(op*150.+19.)-.5, vnoise(op*150.+41.)-.5)*k1*(0.22+0.60*upF)
            +vec3(vnoise(op*38.)-.5, vnoise(op*38.+23.)-.5, vnoise(op*38.+47.)-.5)*k2*0.13;
      N=normalize(N+g*bumpK);
      base*=1.-0.16*upF*k1*bumpK*(vnoise(op*150.+77.)-0.35);
    }
  }
  vec3 F0=mix(mix(vec3(0.04),vec3(0.09,0.085,0.10),glass), base, metal);
  vec3 diffC=base*(1.-metal);
  float NV=max(dot(N,V),1e-3);
  // ключевой свет (большой софтбокс) с мягкой тенью
  vec3 L=u_lightDir; float NL=max(dot(N,L),0.);
  float sh=NL>0.? shadowKey(v_wp,Ng,rot):0.;
  vec3 H=normalize(L+V); float NH=max(dot(N,H),0.), VH=max(dot(V,H),0.);
  float a=max(rough*rough,0.03); float a2=a*a;
  float dd=NH*NH*(a2-1.)+1.; float D=a2/(PI*dd*dd);
  float k=(rough+1.)*(rough+1.)/8.; float G=(NL/(NL*(1.-k)+k))*(NV/(NV*(1.-k)+k));
  vec3 F=F0+(1.-F0)*pow(1.-VH,5.);
  vec3 spec=min(D*G/(4.*NL*NV+1e-4), 30.)*F;
  vec3 direct=(diffC*(1.-F)/PI+spec)*u_lightCol*NL*sh;
  // окружение
  float sv=skyVis(v_wp,Ng,rot);
  float occl=mix(0.22,1.,sv*sv*(3.-2.*sv));
  vec3 amb=diffC*irradiance(N)*occl;
  vec3 R=reflect(-V,N);
  vec4 c0=vec4(-1.,-0.0275,-0.572,0.022), c1=vec4(1.,0.0425,1.04,-0.04);
  vec4 rr=rough*c0+c1; float a004=min(rr.x*rr.x,exp2(-9.28*NV))*rr.x+rr.y; vec2 AB=vec2(-1.04,1.04)*a004+rr.zw;
  float hor=clamp(1.+1.4*dot(R,Ng),0.,1.);
  vec3 specEnv=envMap(R,rough)*(F0*AB.x+AB.y)*mix(0.25,1.,sv)*hor*hor;
  amb+=specEnv;
  if(u_ground>0.5){ amb=mix(amb,u_horizon,fadeOut); direct*=1.-fadeOut; }
  o_amb=vec4(amb,1.); o_dir=vec4(direct,1.);
  o_nrm=vec4(normalize(mat3(u_view)*Ng)*0.5+0.5,1.);
}`;

const VS_DEPTH = `#version 300 es
layout(location=0) in vec3 a_pos; uniform mat4 u_mvp; void main(){ gl_Position=u_mvp*vec4(a_pos,1.); }`;
const FS_DEPTH = `#version 300 es
precision mediump float; void main(){}`;

const VS_QUAD = `#version 300 es
out vec2 v_uv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); v_uv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;

const FS_BG = `#version 300 es
precision highp float; in vec2 v_uv; uniform mat4 u_invViewProj; uniform vec3 u_cam, u_horizon;
layout(location=0) out vec4 o_amb; layout(location=1) out vec4 o_dir; layout(location=2) out vec4 o_nrm;
void main(){ vec4 p=u_invViewProj*vec4(v_uv*2.-1.,1.,1.); vec3 d=normalize(p.xyz/p.w-u_cam);
  float t=smoothstep(0.,0.75,d.y);
  vec3 c=mix(u_horizon, u_horizon*vec3(0.30,0.31,0.34), t);
  c=mix(c,u_horizon,smoothstep(0.,-0.05,d.y));
  o_amb=vec4(c,1.); o_dir=vec4(0.,0.,0.,1.); o_nrm=vec4(0.5,0.5,1.,1.); }`;

const FS_AO = `#version 300 es
precision highp float; in vec2 v_uv; uniform highp sampler2D u_depth; uniform sampler2D u_nrm; uniform mat4 u_proj, u_invProj; uniform vec2 u_res;
out vec4 o;
${NOISE}
vec3 vpos(vec2 uv){ float d=texture(u_depth,uv).r; vec4 v=u_invProj*vec4(uv*2.-1.,d*2.-1.,1.); return v.xyz/v.w; }
void main(){
  float d0=texture(u_depth,v_uv).r; if(d0>=1.){ o=vec4(1.,0.,0.,1.); return; }
  vec3 P=vpos(v_uv); vec3 N=normalize(texture(u_nrm,v_uv).xyz*2.-1.);
  float rot=ign(gl_FragCoord.xy)*6.2831853;
  vec3 up=abs(N.z)<0.9?vec3(0,0,1):vec3(1,0,0); vec3 T=normalize(cross(up,N)), B=cross(N,T);
  float occS=0., occL=0.;
  const int NS=22;
  for(int i=0;i<NS;i++){
    float fi=float(i)+0.5; float u=fi/float(NS);
    float ph=fi*2.39996323+rot; float ct=sqrt(1.-u*0.92), st=sqrt(1.-ct*ct);
    vec3 dir=T*cos(ph)*st+B*sin(ph)*st+N*ct;
    bool sm=(i&1)==0;
    float R=sm?0.085:0.42;
    float len=R*mix(0.25,1.,fract(fi*0.618+rot*0.31));
    vec3 S=P+dir*len;
    vec4 q=u_proj*vec4(S,1.); vec2 uv=q.xy/q.w*0.5+0.5;
    float sz=vpos(uv).z;
    float w=smoothstep(0.,1.,R/max(abs(P.z-sz),1e-4));
    float oc=step(S.z+0.012*(sm?1.:3.), sz)*w;
    if(sm) occS+=oc; else occL+=oc;
  }
  float ao=(1.-occS/float(NS/2))*mix(1.,1.-occL/float(NS/2),0.85);
  o=vec4(ao,-P.z,0.,1.);
}`;

const FS_BLUR = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_ao; uniform vec2 u_texel; out vec4 o;
void main(){ vec2 c=texture(u_ao,v_uv).rg; float s=0., w=0.;
  for(int y=-2;y<2;y++) for(int x=-2;x<2;x++){ vec2 t=texture(u_ao,v_uv+(vec2(float(x),float(y))+0.5)*u_texel).rg;
    float k=1./(1.+abs(t.g-c.g)*18.); k=step(abs(t.g-c.g),0.25)*k; s+=t.r*k; w+=k; }
  o=vec4(w>0.?s/w:c.r, c.g, 0., 1.); }`;

const FS_COMP = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_amb, u_dir, u_ao; uniform vec2 u_texel; uniform float u_exposure, u_aoPow; out vec4 o;
${NOISE}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
vec3 shade(vec2 uv){
  vec3 a=texture(u_amb,uv).rgb, d=texture(u_dir,uv).rgb; float ao=pow(texture(u_ao,uv).r,u_aoPow);
  vec3 c=a*ao+d*mix(1.,ao,0.45);
  c*=u_exposure;
  return pow(aces(c),vec3(1./2.2));
}
void main(){
  vec3 c=vec3(0.);
  c+=shade(v_uv+vec2(-.5,-.5)*u_texel); c+=shade(v_uv+vec2(.5,-.5)*u_texel);
  c+=shade(v_uv+vec2(-.5,.5)*u_texel);  c+=shade(v_uv+vec2(.5,.5)*u_texel);
  c*=0.25;
  vec2 q=v_uv-0.5; c*=1.-0.38*smoothstep(0.25,0.95,dot(q,q)*2.2);
  c+=(ign(gl_FragCoord.xy)-0.5)/255.;
  o=vec4(c,1.);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
    return s;
  };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: /[?&]still=1/.test(location.search) });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl; this.canvas = canvas;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.pMain = compile(gl, VS_MAIN, FS_MAIN);
    this.pDepth = compile(gl, VS_DEPTH, FS_DEPTH);
    this.pBg = compile(gl, VS_QUAD, FS_BG);
    this.pAo = compile(gl, VS_QUAD, FS_AO);
    this.pBlur = compile(gl, VS_QUAD, FS_BLUR);
    this.pComp = compile(gl, VS_QUAD, FS_COMP);
    this.groups = {};
    this.lightDir = V.norm([0.46, 0.74, 0.52]);
    this.lightCol = [3.5, 3.34, 3.08];
    this.horizon = [0.060, 0.057, 0.054];
    this.exposure = 0.96;
    this.shadowSize = 2048; this.skySize = 1024;
    this.shadowFbo = this._depthTarget(this.shadowSize);
    this.skyFbo = this._depthTarget(this.skySize);
    this.w = 0; this.h = 0;
    this.emptyVao = gl.createVertexArray();
  }
  _depthTarget(size) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    return { fbo, tex, size };
  }
  _tex(w, h, ifmt, filter) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  resize(w, h, ss) {
    const gl = this.gl;
    const iw = Math.max(2, Math.round(w * ss)), ih = Math.max(2, Math.round(h * ss));
    if (iw === this.iw && ih === this.ih && w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.iw = iw; this.ih = ih;
    this.canvas.width = w; this.canvas.height = h;
    for (const t of this.targets || []) gl.deleteTexture(t);
    for (const f of this.fbos || []) gl.deleteFramebuffer(f);
    const cf = this.hdr ? gl.RGBA16F : gl.RGBA8;
    this.tAmb = this._tex(iw, ih, cf, gl.LINEAR); this.tDir = this._tex(iw, ih, cf, gl.LINEAR);
    this.tNrm = this._tex(iw, ih, gl.RGBA8, gl.NEAREST); this.tDepth = this._tex(iw, ih, gl.DEPTH_COMPONENT24, gl.NEAREST);
    this.fMain = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fMain);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tAmb, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.tDir, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.tNrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    this.aw = Math.max(1, iw >> 1); this.ah = Math.max(1, ih >> 1);
    const af = this.hdr ? gl.RG16F : gl.RGBA8;
    this.tAo = this._tex(this.aw, this.ah, af, gl.LINEAR); this.tAo2 = this._tex(this.aw, this.ah, af, gl.LINEAR);
    this.fAo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fAo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tAo, 0);
    this.fAo2 = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fAo2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tAo2, 0);
    this.targets = [this.tAmb, this.tDir, this.tNrm, this.tDepth, this.tAo, this.tAo2];
    this.fbos = [this.fMain, this.fAo, this.fAo2];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  addGroup(name, mesh, seed = 0) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data, loc, size, type, norm) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
    };
    buf(mesh.pos, 0, 3, gl.FLOAT, false); buf(mesh.nrm, 1, 4, gl.SHORT, true);
    buf(mesh.col, 2, 4, gl.UNSIGNED_BYTE, true); buf(mesh.mat, 3, 4, gl.UNSIGNED_BYTE, true);
    gl.bindVertexArray(null);
    this.groups[name] = { vao, count: mesh.count, model: M.ident(), seed, ground: name === 'ground' };
  }
  _depthPass(target, mvp) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.size, target.size);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pDepth.p);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
    for (const k in this.groups) {
      const g = this.groups[k]; if (g.ground) continue;
      gl.uniformMatrix4fv(this.pDepth.u.u_mvp, false, M.mul(mvp, g.model));
      gl.bindVertexArray(g.vao); gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
  render(cam) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    // --- карты теней ---
    const c = [0.9, 1.2, 0], R = 7.2;
    const lv = M.lookAt(V.add(c, V.mul(this.lightDir, 20)), c, [0, 1, 0]);
    const shadowMat = M.mul(M.ortho(-R, R, -R, R, 8, 32), lv);
    this._depthPass(this.shadowFbo, shadowMat);
    const sv = M.lookAt([c[0], 20, 0], [c[0], 0, 0], [0, 0, -1]);
    const skyMat = M.mul(M.ortho(-R, R, -R, R, 10, 21), sv);
    this._depthPass(this.skyFbo, skyMat);
    // --- основной проход (MRT) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fMain); gl.viewport(0, 0, this.iw, this.ih);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = M.mul(cam.proj, cam.view), ivp = M.invert(vp);
    gl.depthMask(false);
    gl.useProgram(this.pBg.p); gl.bindVertexArray(this.emptyVao);
    gl.uniformMatrix4fv(this.pBg.u.u_invViewProj, false, ivp); gl.uniform3fv(this.pBg.u.u_cam, cam.pos); gl.uniform3fv(this.pBg.u.u_horizon, this.horizon);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    const P = this.pMain; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.u_viewProj, false, vp); gl.uniformMatrix4fv(P.u.u_view, false, cam.view);
    gl.uniformMatrix4fv(P.u.u_shadowMat, false, shadowMat); gl.uniformMatrix4fv(P.u.u_skyMat, false, skyMat);
    gl.uniform3fv(P.u.u_cam, cam.pos); gl.uniform3fv(P.u.u_lightDir, this.lightDir); gl.uniform3fv(P.u.u_lightCol, this.lightCol);
    gl.uniform3fv(P.u.u_horizon, this.horizon);
    gl.uniform1f(P.u.u_shadowTexel, 1 / this.shadowSize); gl.uniform1f(P.u.u_skyTexel, 1 / this.skySize);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowFbo.tex); gl.uniform1i(P.u.u_shadow, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.skyFbo.tex); gl.uniform1i(P.u.u_sky, 1);
    for (const k in this.groups) {
      const g = this.groups[k];
      gl.uniformMatrix4fv(P.u.u_model, false, g.model); gl.uniform1f(P.u.u_ground, g.ground ? 1 : 0); gl.uniform1f(P.u.u_groupSeed, g.seed);
      gl.bindVertexArray(g.vao); gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
    // --- SSAO ---
    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fAo); gl.viewport(0, 0, this.aw, this.ah);
    gl.useProgram(this.pAo.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tDepth); gl.uniform1i(this.pAo.u.u_depth, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tNrm); gl.uniform1i(this.pAo.u.u_nrm, 1);
    gl.uniformMatrix4fv(this.pAo.u.u_proj, false, cam.proj); gl.uniformMatrix4fv(this.pAo.u.u_invProj, false, M.invert(cam.proj));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fAo2);
    gl.useProgram(this.pBlur.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tAo); gl.uniform1i(this.pBlur.u.u_ao, 0);
    gl.uniform2f(this.pBlur.u.u_texel, 1 / this.aw, 1 / this.ah);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // --- композиция + тонмаппинг + сведение суперсэмплинга ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.pComp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tAmb); gl.uniform1i(this.pComp.u.u_amb, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tDir); gl.uniform1i(this.pComp.u.u_dir, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tAo2); gl.uniform1i(this.pComp.u.u_ao, 2);
    const so = (this.ss || 2) / 2; gl.uniform2f(this.pComp.u.u_texel, so / this.iw, so / this.ih); gl.uniform1f(this.pComp.u.u_exposure, this.exposure); gl.uniform1f(this.pComp.u.u_aoPow, 2.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
