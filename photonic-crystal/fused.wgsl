// Here electric is the source E/H state, magnetic the destination E/H state.
// Each buffer contains N electric vec2 values followed by N magnetic vec2 values.
override parity:u32=0u;
var<workgroup> tileH:array<vec2f,297>; // (32+1) * (8+1), with left/bottom halo
var<workgroup> temporal:vec4f;
fn nextH(cell:vec2i)->vec2f{
    var a=clamp(cell,vec2i(0),vec2i(p.dims.xy)-1);
    if(p.dims.w==2u){a=(cell+vec2i(p.dims.xy))%vec2i(p.dims.xy);}
    let i=u32(a.x)+p.dims.x*u32(a.y);let e=ez(a);let old=electric[p.dims.z+i];
    let cx=axes[u32(a.x)].zw;let cy=axes[p.dims.x+u32(a.y)].zw;
    return vec2f(cy.x*old.x-cy.y*(ez(a+vec2i(0,1))-e),cx.x*old.y+cx.y*(ez(a+vec2i(1,0))-e));
}
@compute @workgroup_size(32,8)
fn stepFused(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) local:vec3u){
    // All supported grids are exact multiples of 32x8; every invocation reaches the barrier.
    let i=id.x+p.dims.x*id.y;let a=vec2i(id.xy);let slot=local.x+1u+33u*(local.y+1u);
    let h=nextH(a);tileH[slot]=h;
    if(local.x==0u){tileH[slot-1u]=nextH(a-vec2i(1,0));}
    if(local.y==0u){tileH[slot-33u]=nextH(a-vec2i(0,1));}
    if(all(local.xy==vec2u(0))){
        let phase=fract(clock[4u*parity]+p.grid.z*p.grid.y);let time=clock[4u*parity+1u]+p.grid.y;
        let ramp=1.-exp(-pow(time*p.grid.z/3.,2.));
        temporal=vec4f(phase,time,p.grid.w*sin(TAU*phase)*ramp,1.-exp(-p.grid.y*p.grid.z/3.));
    }
    workgroupBarrier();
    let cx=axes[id.x].xy;let cy=axes[p.dims.x+id.y].xy;let old=electric[i];
    var e=vec2f(cx.x*old.x+cx.y*(h.y-tileH[slot-1u].y)/epsilon[i],
        cy.x*old.y-cy.y*(h.x-tileH[slot-33u].x)/epsilon[i]);
    if(p.dims.w==0u){
        let current=temporal.z*axes[p.dims.x+p.dims.y+id.x].x*axes[2u*p.dims.x+p.dims.y+id.y].x;
        e+=vec2f(.5*p.grid.y*current/epsilon[i]);
    }
    if(p.dims.w!=2u&&(any(id.xy==vec2u(0))||any(id.xy==p.dims.xy-1u))){e=vec2f(0);}
    magnetic[i]=e;magnetic[p.dims.z+i]=h;
    intensity[i]=mix(intensity[i],(e.x+e.y)*(e.x+e.y),temporal.w);
    // Clock reads and writes use different slots, just like the two field buffers.
    if(i==0u){let offset=4u*(1u-parity);clock[offset]=temporal.x;clock[offset+1u]=temporal.y;}
}
