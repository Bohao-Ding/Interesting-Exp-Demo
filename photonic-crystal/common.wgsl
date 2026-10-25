struct Params {
    dims:vec4u, // Nx, Ny, cells, test: 0 crystal / 1 vacuum pulse / 2 periodic wave
    grid:vec4f, // dx/a, c dt/a, f a/c, source enabled
    domain:vec4f, // origin x,y and size x,y, in a
    structure:vec4f, // preset, defect radius/a, source x,y
}
const TAU:f32=6.28318530718;
fn point(cell:vec2u)->vec2f{return p.domain.xy+(vec2f(cell)+.5)*p.grid.x;}
fn radius(rod:vec2i)->f32{
    if(abs(rod.x)>12||abs(rod.y)>8){return 0.;}
    let edit=edits[u32(rod.x+12+25*(rod.y+8))];
    if(edit>=0.){return edit;}
    let kind=u32(p.structure.x);
    let defect=(kind==1u&&rod.y==0)||(kind==2u&&((rod.y==0&&rod.x<=2)||(rod.x==2&&rod.y>=0)))||(kind==3u&&all(rod==vec2i(0)));
    return select(.2,p.structure.y,defect);
}
