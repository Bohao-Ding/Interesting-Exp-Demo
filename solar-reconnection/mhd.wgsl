struct Params { dims: vec4u, grid: vec4f, control: vec4f }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read> input: array<vec2f>;
@group(0) @binding(2) var<storage,read_write> previous: array<vec2f>;
@group(0) @binding(3) var<storage,read_write> output: array<vec2f>;
@group(0) @binding(4) var<storage,read_write> phi: array<f32>;
@group(0) @binding(5) var<storage,read_write> current: array<f32>;
@group(0) @binding(6) var<storage,read_write> fft0: array<vec2f>;
@group(0) @binding(7) var<storage,read_write> fft1: array<vec2f>;
var<workgroup> tile: array<vec2f, 1024>;
const PI: f32 = 3.141592653589793;

fn idx(x:i32,y:i32)->u32 {
    let n=i32(p.dims.x); return u32((x+n)%n)+p.dims.x*u32((y+n)%n);
}
fn logcosh(x:f32)->f32 { let a=abs(x); return a+log(1.+exp(-2.*a))-log(2.); }
@compute @workgroup_size(16,8) fn initialize(@builtin(global_invocation_id) id:vec3u) {
    let n=p.dims.x; if(id.x>=n||id.y>=n){return;}
    let x=(f32(id.x)+.5)*p.grid.x; let y=(f32(id.y)+.5)*p.grid.x;
    var a=0.; var w=0.;
    if(p.dims.z==1u){
        let eig=4.*(pow(sin(p.grid.x),2.)+pow(sin(1.5*p.grid.x),2.))/(p.grid.x*p.grid.x);
        w=eig*sin(2.*x)*sin(3.*y);
    } else if(p.dims.z==2u){a=sin(2.*x);}
    else {
        let width=p.control.x; let x1=PI*.5; let x2=PI*1.5;
        a=width*(logcosh((x-x1)/width)-logcosh((x-x2)/width))-x+PI;
        let g1=exp(-pow((x-x1)/(.45),2.)); let g2=exp(-pow((x-x2)/(.45),2.));
        let irregular1=(sin(y+.37)+.65*cos(2.*y-.9)+.38*sin(3.*y+1.8)+.24*cos(5.*y+.6))/2.27;
        let irregular2=(.8*sin(y+1.6)-.6*cos(3.*y-.4)+.4*sin(4.*y+2.1)+.25*cos(6.*y))/2.05;
        a+=p.control.y*(irregular1*g1+irregular2*g2);
    }
    output[id.x+n*id.y]=vec2f(a,w);
}

fn butterfly(tid:u32, inverse:bool) {
    workgroupBarrier();
    for(var stage=1u;stage<=p.dims.y;stage++){
        let width=1u<<stage; let half=width>>1u;
        for(var q=tid;q<p.dims.x/2u;q+=128u){
            let k=q%half; let a=(q/half)*width+k; let b=a+half;
            let angle=select(-1.,1.,inverse)*2.*PI*f32(k)/f32(width);
            let w=vec2f(cos(angle),sin(angle)); let z=tile[b];
            let v=vec2f(w.x*z.x-w.y*z.y,w.x*z.y+w.y*z.x); let u=tile[a];
            tile[a]=u+v; tile[b]=u-v;
        }
        workgroupBarrier();
    }
}
fn rev(i:u32)->u32 { return reverseBits(i)>>(32u-p.dims.y); }
@compute @workgroup_size(128) fn forwardRows(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) tid:u32){
    let n=p.dims.x;
    for(var i=tid;i<n;i+=128u){tile[i]=vec2f(input[rev(i)+n*g.x].y,0.);}
    butterfly(tid,false);
    for(var i=tid;i<n;i+=128u){fft0[i+n*g.x]=tile[i];}
}
@compute @workgroup_size(128) fn forwardColumns(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) tid:u32){
    let n=p.dims.x;
    for(var i=tid;i<n;i+=128u){tile[i]=fft0[g.x+n*rev(i)];}
    butterfly(tid,false);
    for(var i=tid;i<n;i+=128u){
        let eig=4.*(pow(sin(PI*f32(g.x)/f32(n)),2.)+pow(sin(PI*f32(i)/f32(n)),2.))/(p.grid.x*p.grid.x);
        fft1[g.x+n*i]=select(vec2f(0.),tile[i]/max(eig,1.e-20),eig>1.e-20);
    }
}
@compute @workgroup_size(128) fn inverseColumns(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) tid:u32){
    let n=p.dims.x;
    for(var i=tid;i<n;i+=128u){tile[i]=fft1[g.x+n*rev(i)];}
    butterfly(tid,true);
    for(var i=tid;i<n;i+=128u){fft0[g.x+n*i]=tile[i];}
}
@compute @workgroup_size(128) fn inverseRows(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) tid:u32){
    let n=p.dims.x;
    for(var i=tid;i<n;i+=128u){tile[i]=fft0[rev(i)+n*g.x];}
    butterfly(tid,true);
    for(var i=tid;i<n;i+=128u){phi[i+n*g.x]=tile[i].x/f32(n*n);}
}
@compute @workgroup_size(16,8) fn computeCurrent(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=p.dims.x||id.y>=p.dims.x){return;} let x=i32(id.x);let y=i32(id.y);let i=idx(x,y);
    let lap=input[idx(x+1,y)].x+input[idx(x-1,y)].x+input[idx(x,y+1)].x+input[idx(x,y-1)].x-4.*input[i].x;
    current[i]=-lap/(p.grid.x*p.grid.x);
}
// Arakawa's three-stencil Jacobian preserves the cyclic identities of the
// continuous Poisson bracket on a periodic grid.
fn bracket(f:array<f32,9>,g:array<f32,9>)->f32 {
    let j1=(f[5]-f[3])*(g[7]-g[1])-(f[7]-f[1])*(g[5]-g[3]);
    let j2=f[5]*(g[8]-g[2])-f[3]*(g[6]-g[0])-f[7]*(g[8]-g[6])+f[1]*(g[2]-g[0]);
    let j3=g[7]*(f[8]-f[6])-g[1]*(f[2]-f[0])-g[5]*(f[8]-f[2])+g[3]*(f[6]-f[0]);
    return (j1+j2+j3)/(12.*p.grid.x*p.grid.x);
}
fn rhs(x:i32,y:i32)->vec2f {
    var a:array<f32,9>;var w:array<f32,9>;var f:array<f32,9>;var j:array<f32,9>;
    for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
        let i=idx(x+dx,y+dy);let k=u32(dx+1+3*(dy+1));a[k]=input[i].x;w[k]=input[i].y;f[k]=phi[i];j[k]=current[i];
    }}
    let lapw=(w[5]+w[3]+w[7]+w[1]-4.*w[4])/(p.grid.x*p.grid.x);
    return vec2f(bracket(f,a)-p.grid.z*j[4],bracket(f,w)+bracket(j,a)+p.grid.w*lapw);
}
@compute @workgroup_size(16,8) fn euler(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=p.dims.x||id.y>=p.dims.x){return;}let i=id.x+p.dims.x*id.y;
    let f=rhs(i32(id.x),i32(id.y));output[i]=input[i]+p.grid.y*f;previous[i]=f;
}
@compute @workgroup_size(16,8) fn adamsBashforth(@builtin(global_invocation_id) id:vec3u){
    if(id.x>=p.dims.x||id.y>=p.dims.x){return;}let i=id.x+p.dims.x*id.y;
    let f=rhs(i32(id.x),i32(id.y));output[i]=input[i]+p.grid.y*(1.5*f-.5*previous[i]);previous[i]=f;
}
