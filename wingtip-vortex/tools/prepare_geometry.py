"""Evaluate NASA WING01 STEP B-splines and build a shared mesh/CFD geometry.

This deliberately supports this file's non-rational tensor-product surfaces only.
SciPy supplies spline evaluation, not a fluid solver or a CAD approximation.
"""
from pathlib import Path
import gzip
import json
import re
import numpy as np
from scipy.interpolate import BSpline

ROOT = Path(__file__).resolve().parents[1]
CHORD = 536.23  # root chord in the NASA Wing Coordinate System, inches
ORIGIN = np.array([-1., -2.8, -1.2])
SIZE = np.array([6., 5.6, 2.4])
C = np.array([(0,0,0),(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1),
    (1,1,0),(-1,-1,0),(1,-1,0),(-1,1,0),(1,0,1),(-1,0,-1),(1,0,-1),(-1,0,1),
    (0,1,1),(0,-1,-1),(0,1,-1),(0,-1,1)])

def split_args(text):
    parts, start, depth, quoted = [], 0, 0, False
    for i, ch in enumerate(text):
        if ch == "'": quoted = not quoted
        elif not quoted:
            if ch == '(': depth += 1
            elif ch == ')': depth -= 1
            elif ch == ',' and depth == 0:
                parts.append(text[start:i]); start = i+1
    return parts + [text[start:]]

def surfaces():
    source = (ROOT/'data/wing01.stp').read_text()
    points = {int(i): np.array([float(x) for x in p.split(',')])
        for i,p in re.findall(r'#(\d+)=CARTESIAN_POINT\([^,]*,\(([^)]+)\)\);', source)}
    result = {}
    for entity in re.findall(r'B_SPLINE_SURFACE_WITH_KNOTS\((.*?)\);', source, re.S):
        a = split_args(entity)
        name = a[0].strip("'")
        grid = [[points[int(i)] for i in re.findall(r'#(\d+)', row)]
                for row in re.findall(r'\(([^()]+)\)', a[3])]
        controls = np.array(grid)
        numbers = lambda text: np.array([float(x) for x in text.strip('()').split(',')])
        knots = [np.repeat(numbers(a[10+i]), numbers(a[8+i]).astype(int)) for i in range(2)]
        degrees = [int(a[1]), int(a[2])]
        def evaluate(u, v, controls=controls, knots=knots, degrees=degrees):
            basis = [BSpline.design_matrix(k[d]+np.asarray(t)*(k[-d-1]-k[d]), k, d).toarray()
                     for t,k,d in zip([u,v],knots,degrees)]
            return np.einsum('ui,ijc,vj->uvc', basis[0], controls, basis[1], optimize=True)
        result[name] = evaluate
    if set(result) != {'WING01IF','WING01ILA','WING01IUA','WING01ITE',
        'WING01OF','WING01OLA','WING01OUA','WING01OTE','WING01TIP'}:
        raise ValueError('Unexpected STEP surfaces; inspect before adapting parser.')
    return result

def triangles(a):
    return np.concatenate([np.stack([a[:-1,:-1],a[1:,:-1],a[1:,1:]],-2).reshape(-1,3,3),
        np.stack([a[:-1,:-1],a[1:,1:],a[:-1,1:]],-2).reshape(-1,3,3)])

def dihedral(a):
    a = a.copy()/CHORD
    angle = np.deg2rad(5)
    y,z = a[...,1].copy(),a[...,2].copy()
    a[...,1] = y*np.cos(angle)-z*np.sin(angle)
    # Isolated full-wing join: pin the root boundary to the symmetry plane.
    # The small adjustment lies inside the region normally enclosed by the fuselage.
    a[...,1] = np.where(abs(y)<1e-12,0.,a[...,1])
    a[...,2] = y*np.sin(angle)+z*np.cos(angle)
    return a

def ray_heights(tris, xs, ys):
    low = np.full((len(ys),len(xs)), np.inf)
    high = np.full_like(low, -np.inf)
    for t in tris:
        x0,x1=np.searchsorted(xs,[t[:,0].min()-1e-9,t[:,0].max()+1e-9])
        y0,y1=np.searchsorted(ys,[t[:,1].min()-1e-9,t[:,1].max()+1e-9])
        if x1<=x0 or y1<=y0: continue
        e1,e2=t[1]-t[0],t[2]-t[0]
        det=e1[0]*e2[1]-e1[1]*e2[0]
        if abs(det)<1e-15: continue
        X,Y=np.meshgrid(xs[x0:x1]-t[0,0],ys[y0:y1]-t[0,1])
        u=(X*e2[1]-Y*e2[0])/det;v=(Y*e1[0]-X*e1[1])/det
        inside=(u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8)
        z=t[0,2]+u*e1[2]+v*e2[2]
        low[y0:y1,x0:x1]=np.minimum(low[y0:y1,x0:x1],np.where(inside,z,np.inf))
        high[y0:y1,x0:x1]=np.maximum(high[y0:y1,x0:x1],np.where(inside,z,-np.inf))
    return low,high

def panel_links(flags, tris, dx):
    # Thin plates intersect lattice links. No cosmetic-only plates or bulk filling.
    nz,ny,nx=flags.shape
    for t in tris:
        start=np.maximum(np.floor((t.min(0)-ORIGIN)/dx-1).astype(int),0)
        stop=np.minimum(np.ceil((t.max(0)-ORIGIN)/dx+1).astype(int),[nx-1,ny-1,nz-1])
        z,y,x=np.meshgrid(np.arange(start[2],stop[2]+1),np.arange(start[1],stop[1]+1),np.arange(start[0],stop[0]+1),indexing='ij')
        xyz=np.stack([x.ravel(),y.ravel(),z.ravel()],1)
        starts=ORIGIN+(xyz+.5)*dx
        e1,e2=t[1]-t[0],t[2]-t[0]
        s=starts-t[0]
        for q in range(1,19):
            direction=-C[q]*dx
            h=np.cross(direction,e2);det=e1@h
            if abs(det)<1e-15:continue
            u=s@h/det;cross=np.cross(s,e1);v=cross@direction/det;dist=cross@e2/det
            hit=(u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8)&(dist>1e-8)&(dist<=1+1e-8)
            pts=xyz[hit];flags[pts[:,2],pts[:,1],pts[:,0]] |= np.uint32(1<<q)

def build():
    surf=surfaces(); pieces=[]; coordinates={}
    u=.5*(1-np.cos(np.linspace(0,np.pi,161)))
    for name,fn in surf.items():
        if name.endswith(('ITE','OTE')):continue # untrimmed cap planes extend beyond the wing
        a=fn(u,np.linspace(0,1,81));coordinates[name]=a
        pieces.append(triangles(a))
    # Close the finite-thickness trailing edge using actual upper/lower CAD boundaries.
    for prefix in ['I','O']:
        a,b=coordinates[f'WING01{prefix}UA'],coordinates[f'WING01{prefix}LA']
        upper=a[np.argmax(a[:,40,0])];lower=b[np.argmax(b[:,40,0])]
        pieces.append(triangles(np.stack([upper,lower])))
    wing=np.concatenate(pieces)
    wing=dihedral(wing)
    mirrored=wing[:,[0,2,1]].copy();mirrored[:,:,1]*=-1
    wing=np.concatenate([wing,mirrored])
    area=np.linalg.norm(np.cross(wing[:,1]-wing[:,0],wing[:,2]-wing[:,0]),axis=1)
    wing=wing[area>1e-13]
    # Research add-ons: they are not part of NASA's reference configuration.
    devices=[]; description=[]
    triangle_min,triangle_max=wing.min(1),wing.max(1)
    cloud=wing.reshape(-1,3)
    def upper(x,y):
        selected=(triangle_min[:,0]<=x)&(triangle_max[:,0]>=x)&(triangle_min[:,1]<=y)&(triangle_max[:,1]>=y)
        _,high=ray_heights(wing[selected],np.array([x]),np.array([y]));return float(high[0,0])
    def section(y):
        near=cloud[abs(cloud[:,1]-y)<.014]
        return float(near[:,0].min()),float(near[:,0].max())
    for sign in [-1,1]:
        # A chordwise wing fence. Bottom edge follows the actual CAD upper surface.
        y=sign*1.25;le,te=section(y);c=te-le
        xs=np.linspace(le+.12*c,le+.65*c,20)
        bottom=np.array([[x,y,upper(x,y)-.002] for x in xs]);top=bottom.copy();top[:,2]+=.085*c
        fence=triangles(np.stack([bottom,top]));devices.append((fence,2))
        description.append(dict(kind='wing fence',y=y,chord_fraction=[.12,.65],height_local_chord=.085))
        for span in [(0.65,1.0),(1.35,1.65)]:
            ys=sign*np.linspace(*span,12);front=[];back=[]
            for yy in ys:
                le,te=section(yy);c=te-le;x=le+.62*c;z=upper(x,yy)
                front.append([x,yy,z]);back.append([x+.14*c*np.cos(np.deg2rad(25)),yy,z+.14*c*np.sin(np.deg2rad(25))])
            spoiler=triangles(np.stack([front,back]));devices.append((spoiler,1))
            description.append(dict(kind='spoiler',span=list(sign*np.array(span)),hinge_local_chord=.62,length_local_chord=.14,deflection_deg=25))
    mesh=[]
    for tris,material in [(wing,0),*devices]:
        normals=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0]);normals/=np.linalg.norm(normals,axis=1,keepdims=True)
        records=np.concatenate([tris,np.repeat(normals[:,None],3,1),np.full((*tris.shape[:2],1),material)],axis=2)
        mesh.append(records.reshape(-1,7))
    np.concatenate(mesh).astype('<f4').tofile(ROOT/'data/mesh.bin')
    metadata=dict(source='NASA CRM-HL WING01',source_url='https://www.nasa.gov/wp-content/uploads/2023/02/wing01.stp.zip',
        root_chord_inches=CHORD,mac=275.8/CHORD,area=2*191.844778/(CHORD*.0254)**2,dihedral_deg=5,
        root_join='Wing-root boundary pinned to y=0 for an isolated mirrored full wing; no fuselage.',
        domain=dict(origin=ORIGIN.tolist(),size=SIZE.tolist()),wing_triangles=len(wing),
        mesh_vertices=sum(len(m) for m in mesh),wing_vertices=len(mesh[0]),devices=description,
        bounds=[cloud.min(0).tolist(),cloud.max(0).tolist()],grids={},sections=[])
    for y in np.linspace(-2.14,2.14,129):
        le,te=section(y);x=le+.25*(te-le)
        selected=(triangle_min[:,0]<=x)&(triangle_max[:,0]>=x)&(triangle_min[:,1]<=y)&(triangle_max[:,1]>=y)
        low,high=ray_heights(wing[selected],np.array([x]),np.array([y]))
        metadata['sections'].append(dict(y=float(y),le=le,te=te,x=x,z=float(high[0,0]),lower=float(low[0,0])))
    for resolution in [20,40,60]:
        dims=np.rint(SIZE*resolution).astype(int);nx,ny,nz=dims;dx=1/resolution
        xs=ORIGIN[0]+(np.arange(nx)+.5)*dx;ys=ORIGIN[1]+(np.arange(ny)+.5)*dx;zs=ORIGIN[2]+(np.arange(nz)+.5)*dx
        low,high=ray_heights(wing,xs,ys)
        solid=(zs[:,None,None]>=low[None])&(zs[:,None,None]<=high[None])
        flags=np.where(solid,np.uint32(0x80000000),np.uint32(0))
        for q,(cx,cy,cz) in enumerate(C[1:],1):
            neighbors=np.roll(solid,(cz,cy,cx),axis=(0,1,2))
            flags[neighbors&~solid] |= np.uint32(1<<q)
        for mode in ['clean','devices']:
            final=flags.copy()
            if mode=='devices':
                for tris,_ in devices:panel_links(final,tris,dx)
            with gzip.open(ROOT/f'data/grid-{resolution}-{mode}.bin.gz','wb',compresslevel=6) as out:
                out.write(final.astype('<u4').tobytes())
            metadata['grids'][f'{resolution}-{mode}']=dict(dims=dims.tolist(),cells=int(np.prod(dims)),
                solid_cells=int(solid.sum()),wall_link_cells=int(((final&0x7fffffff)>0).sum()))
        print('Prepared',resolution,dims,'solid',solid.sum(),flush=True)
    (ROOT/'data/geometry.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print('CAD mesh',metadata['wing_triangles'],'bounds',metadata['bounds'])

if __name__=='__main__':build()
