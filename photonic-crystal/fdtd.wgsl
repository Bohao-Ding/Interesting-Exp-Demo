@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> electric:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> magnetic:array<vec2f>;
@group(0) @binding(3) var<storage,read_write> epsilon:array<f32>;
@group(0) @binding(4) var<storage,read_write> intensity:array<f32>;
@group(0) @binding(5) var<storage,read> edits:array<f32>;
@group(0) @binding(6) var<storage,read_write> clock:array<f32>;
@group(0) @binding(7) var<storage,read_write> axes:array<vec4f>;
override fused:bool=false;
fn index(cell:vec2i)->u32{
    var a=clamp(cell,vec2i(0),vec2i(p.dims.xy)-1);
    if(p.dims.w==2u){a=(cell+vec2i(p.dims.xy))%vec2i(p.dims.xy);}
    return u32(a.x)+p.dims.x*u32(a.y);
}
fn ez(cell:vec2i)->f32{let e=electric[index(cell)];return e.x+e.y;}
fn sigma(x:f32,axis:u32)->f32{
    if(p.dims.w==2u){return 0.;}
    let d=min(x-p.domain[axis],p.domain[axis]+p.domain[axis+2u]-x);
    let q=max(0.,1.-d/2.);
    return 16.118095*q*q*q;
}
fn coefficients(s:f32)->vec2f{let q=.5*s*p.grid.y;return vec2f((1.-q)/(1.+q),p.grid.y/(p.grid.x*(1.+q)));}
@compute @workgroup_size(16,8)
fn initialize(@builtin(global_invocation_id) id:vec3u){
    if(any(id.xy>=p.dims.xy)){return;}
    let i=id.x+p.dims.x*id.y;let x=point(id.xy);
    var fill=0.;
    if(p.dims.w==0u){
        let rod=vec2i(round(x));let r=radius(rod);
        for(var y=-1;y<=1;y+=2){for(var z=-1;z<=1;z+=2){
            let offset=.25*p.grid.x*vec2f(f32(z),f32(y));
            fill+=select(0.,.25,length(x+offset-vec2f(rod))<r);
        }}
    }
    epsilon[i]=1.+11.*fill;electric[i]=vec2f(0);magnetic[i]=vec2f(0);intensity[i]=0.;
    if(p.dims.w==1u){let g=exp(-dot(x,x)/1.28);electric[i]=vec2f(.5*g);}
    if(p.dims.w==2u){
        let k=TAU*3./p.domain.z;let omega=2.*asin(p.grid.y/p.grid.x*sin(.5*k*p.grid.x))/p.grid.y;
        electric[i]=vec2f(cos(k*x.x),0);
        magnetic[i]=vec2f(0,-cos(k*(x.x+.5*p.grid.x)+.5*omega*p.grid.y));
    }
    if(fused){
        let e=electric[i];let h=magnetic[i];
        electric[p.dims.z+i]=h;magnetic[i]=e;magnetic[p.dims.z+i]=h;
    }
    if(i==0u){clock[0]=0.;clock[1]=0.;clock[4]=0.;clock[5]=0.;}
    if(id.y==0u){
        axes[id.x]=vec4f(coefficients(sigma(x.x,0u)),coefficients(sigma(x.x+.5*p.grid.x,0u)));
        let d=(x.x-p.structure.z)/.14;axes[p.dims.x+p.dims.y+id.x]=vec4f(exp(-.5*d*d),0,0,0);
    }
    if(id.x==0u){
        axes[p.dims.x+id.y]=vec4f(coefficients(sigma(x.y,1u)),coefficients(sigma(x.y+.5*p.grid.x,1u)));
        let d=(x.y-p.structure.w)/.48;axes[2u*p.dims.x+p.dims.y+id.y]=vec4f(exp(-.5*d*d),0,0,0);
    }
}
@compute @workgroup_size(16,8)
fn stepH(@builtin(global_invocation_id) id:vec3u){
    if(any(id.xy>=p.dims.xy)){return;}
    let i=id.x+p.dims.x*id.y;let a=vec2i(id.xy);let x=point(id.xy);let e=ez(a);
    let cx=coefficients(sigma(x.x+.5*p.grid.x,0u));let cy=coefficients(sigma(x.y+.5*p.grid.x,1u));
    let old=magnetic[i];
    magnetic[i]=vec2f(cy.x*old.x-cy.y*(ez(a+vec2i(0,1))-e),cx.x*old.y+cx.y*(ez(a+vec2i(1,0))-e));
    // Only this invocation touches the clock in H; E reads it in the next dispatch.
    if(i==0u){clock[0]=fract(clock[0]+p.grid.z*p.grid.y);clock[1]+=p.grid.y;}
}
@compute @workgroup_size(16,8)
fn stepE(@builtin(global_invocation_id) id:vec3u){
    if(any(id.xy>=p.dims.xy)){return;}
    let i=id.x+p.dims.x*id.y;let a=vec2i(id.xy);let x=point(id.xy);
    let cx=coefficients(sigma(x.x,0u));let cy=coefficients(sigma(x.y,1u));let h=magnetic[i];
    var e=vec2f(cx.x*electric[i].x+cx.y*(h.y-magnetic[index(a-vec2i(1,0))].y)/epsilon[i],
        cy.x*electric[i].y-cy.y*(h.x-magnetic[index(a-vec2i(0,1))].x)/epsilon[i]);
    if(p.dims.w==0u){
        let d=(x-p.structure.zw)/vec2f(.14,.48);
        let ramp=1.-exp(-pow(clock[1]*p.grid.z/3.,2.));
        let current=p.grid.w*sin(TAU*clock[0])*ramp*exp(-.5*dot(d,d));
        e+=vec2f(.5*p.grid.y*current/epsilon[i]);
    }
    if(p.dims.w!=2u&&(any(id.xy==vec2u(0))||any(id.xy==p.dims.xy-1u))){e=vec2f(0);}
    electric[i]=e;
    let beta=1.-exp(-p.grid.y*p.grid.z/3.);
    intensity[i]=mix(intensity[i],(e.x+e.y)*(e.x+e.y),beta);
}
