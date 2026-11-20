# Génère 3 fichiers STEP de référence (AP214) avec OpenCascade, cotes connues.
import math, json, sys
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Vec, gp_Trsf, gp_Ax1
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeTorus, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeBox
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.TopLoc import TopLoc_Location
from OCP.Interface import Interface_Static

from pathlib import Path
OUT = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent / 'fixtures')

def v(a): return gp_Vec(*a)
def P(a): return gp_Pnt(*a)
def D(a): return gp_Dir(*a)
def add(a,b): return [a[i]+b[i] for i in range(3)]
def mul(a,s): return [x*s for x in a]
def norm(a):
    l=math.sqrt(sum(x*x for x in a)); return [x/l for x in a]
def perp(d):
    t=[1,0,0] if abs(d[0])<0.9 else [0,1,0]
    c=[d[1]*t[2]-d[2]*t[1], d[2]*t[0]-d[0]*t[2], d[0]*t[1]-d[1]*t[0]]
    return norm(c)

def cut(a,b): return BRepAlgoAPI_Cut(a,b).Shape()
def fuse(a,b): return BRepAlgoAPI_Fuse(a,b).Shape()

def pipe(p0, d, L, De, Di):
    d=norm(d)
    outer=BRepPrimAPI_MakeCylinder(gp_Ax2(P(p0),D(d),D(perp(d))), De/2, L).Shape()
    inner=BRepPrimAPI_MakeCylinder(gp_Ax2(P(add(p0,mul(d,-1))),D(d),D(perp(d))), Di/2, L+2).Shape()
    return cut(outer,inner)

def bend(center, axis, xdir, R, De, Di, ang_deg):
    a=math.radians(ang_deg)
    outer=BRepPrimAPI_MakeTorus(gp_Ax2(P(center),D(axis),D(xdir)), R, De/2, a).Shape()
    inner=BRepPrimAPI_MakeTorus(gp_Ax2(P(center),D(axis),D(xdir)), R, Di/2, a+0.2).Shape()
    tr=gp_Trsf(); tr.SetRotation(gp_Ax1(P(center),D(axis)), -0.1)
    inner=BRepBuilderAPI_Transform(inner,tr,True).Shape()
    return cut(outer,inner)

def reducer(p0, d, L, De1, Di1, De2, Di2):
    d=norm(d)
    outer=BRepPrimAPI_MakeCone(gp_Ax2(P(p0),D(d),D(perp(d))), De1/2, De2/2, L).Shape()
    s=(Di2-Di1)/2/L  # pente du rayon intérieur
    r1=Di1/2 - s*1; r2=Di2/2 + s*1
    inner=BRepPrimAPI_MakeCone(gp_Ax2(P(add(p0,mul(d,-1))),D(d),D(perp(d))), r1, r2, L+2).Shape()
    return cut(outer,inner)

def tee(c, u, w, Lhalf, Lb, De, Di, Deb, Dib):
    # u = direction principale, w = direction du piquage, c = centre
    u=norm(u); w=norm(w)
    m_out=BRepPrimAPI_MakeCylinder(gp_Ax2(P(add(c,mul(u,-Lhalf))),D(u),D(perp(u))), De/2, 2*Lhalf).Shape()
    b_out=BRepPrimAPI_MakeCylinder(gp_Ax2(P(c),D(w),D(perp(w))), Deb/2, Lb).Shape()
    s=fuse(m_out,b_out)
    m_in=BRepPrimAPI_MakeCylinder(gp_Ax2(P(add(c,mul(u,-Lhalf-1))),D(u),D(perp(u))), Di/2, 2*Lhalf+2).Shape()
    b_in=BRepPrimAPI_MakeCylinder(gp_Ax2(P(c),D(w),D(perp(w))), Dib/2, Lb+1).Shape()
    return cut(cut(s,m_in),b_in)

def box_equipment(xmin,ymin,zmin,dx,dy,dz):
    return BRepPrimAPI_MakeBox(P([xmin,ymin,zmin]),dx,dy,dz).Shape()

class Doc:
    def __init__(self):
        app=XCAFApp_Application.GetApplication_s()
        self.doc=TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
        app.InitDocument(self.doc)
        self.st=XCAFDoc_DocumentTool.ShapeTool_s(self.doc.Main())
    def part(self, shape, name):
        lab=self.st.AddShape(shape, False)
        TDataStd_Name.Set_s(lab, TCollection_ExtendedString(name)); return lab
    def asm(self, name):
        lab=self.st.NewShape(); TDataStd_Name.Set_s(lab, TCollection_ExtendedString(name)); return lab
    def comp(self, asm, part, trsf=None, name=None):
        loc=TopLoc_Location(trsf) if trsf is not None else TopLoc_Location()
        c=self.st.AddComponent(asm, part, loc)
        if name: TDataStd_Name.Set_s(c, TCollection_ExtendedString(name))
        return c
    def write(self, path, unit="MM"):
        self.st.UpdateAssemblies()
        Interface_Static.SetCVal_s("write.step.schema","AP214IS")
        Interface_Static.SetCVal_s("write.step.unit",unit)
        w=STEPCAFControl_Writer(); w.Transfer(self.doc, STEPControl_AsIs); w.Write(path)

truth={}
# ---------- 1. Tube droit ----------
d=Doc(); a=d.asm("TEST1")
De,Di=60.3,52.48
d.comp(a, d.part(pipe([0,0,0],[1,0,0],1000,De,Di),"TUBE_DN50"))
d.write(OUT+"/ref1_tube_droit.stp")
truth["ref1"]={"tubes":[{"Di":Di,"De":De,"L_mm":1000}],"noeuds":2,"extremites":2}

# ---------- 2. Circuit coudes 90/45, réduction, té (unité : mètre) ----------
d=Doc(); a=d.asm("CIRCUIT_TEST2")
R=78.72
P1=pipe([0,0,0],[1,0,0],500,De,Di)
B1=bend([500,0,R],[0,-1,0],[0,0,-1],R,De,Di,90)
P2=pipe([500+R,0,R],[0,0,1],400,De,Di)
c2=[500+2*R,0,R+400]
B2=bend(c2,[0,1,0],[-1,0,0],R,De,Di,45)
s45=math.sqrt(0.5)
e2=add(c2,[-R*s45,0,R*s45]); u=[s45,0,s45]
P3=pipe(e2,u,300,De,Di)
e3=add(e2,mul(u,300))
De2,Di2=33.4,26.64
RED=reducer(e3,u,76,De,Di,De2,Di2)
e4=add(e3,mul(u,76))
P4=pipe(e4,u,200,De2,Di2)
e5=add(e4,mul(u,200))
tc=add(e5,mul(u,38))
TEE=tee(tc,u,[0,1,0],38,38,De2,Di2,De2,Di2)
P5=pipe(add(tc,mul(u,38)),u,250,De2,Di2)
P6=pipe(add(tc,[0,38,0]),[0,1,0],300,De2,Di2)
for shp,nm in [(P1,"TUBE_P1"),(B1,"COUDE_90"),(P2,"TUBE_P2"),(B2,"COUDE_45"),(P3,"TUBE_P3"),(RED,"REDUCTION_50x25"),(P4,"TUBE_P4"),(TEE,"TE_EGAL_DN25"),(P5,"TUBE_P5"),(P6,"TUBE_P6")]:
    d.comp(a, d.part(shp,nm))
d.write(OUT+"/ref2_circuit_coudes_te.stp", unit="M")
truth["ref2"]={"coudes":[{"R":R,"angle":90,"Di":Di},{"R":R,"angle":45,"Di":Di}],
  "reduction":{"D1":Di,"D2":Di2,"L":76,"angle":2*math.degrees(math.atan(((Di-Di2)/2)/76))},
  "te":{"Di":Di2,"angle":90},
  "longueurs_tubes_mm":{"P1":500,"P2":400,"P3":300,"P4":200,
     "te_principal_amont":38,"te_principal_aval":38,"te_derive":38,"P5":250,"P6":300},
  "extremites":3}

# ---------- 3. Assemblage pompe + vanne, sous-ensemble transformé, instances multiples ----------
d=Doc(); top=d.asm("BANC_POMPAGE")
De65,Di65=76.1,68.9
De50,Di50=60.3,52.5
# pompe : bloc + tubulure aspiration (axe X, côté -X) et refoulement (axe Z, vers le haut)
body=box_equipment(-100,-75,-75,200,150,150)
noz_a=pipe([-150,0,0],[1,0,0],60,De65,Di65)      # tubulure aspiration x=-150..-90
noz_r=pipe([0,0,65],[0,0,1],60,De50,Di50)         # tubulure refoulement z=65..125
pump=cut(fuse(fuse(body,noz_a),noz_r), BRepPrimAPI_MakeCylinder(gp_Ax2(P([-151,0,0]),D([1,0,0])),Di65/2,120).Shape())
pump=cut(pump, BRepPrimAPI_MakeCylinder(gp_Ax2(P([0,0,-1]),D([0,0,1])),Di50/2,127).Shape())
pump_l=d.part(pump,"POMPE_CIRC_P1")
asp=d.part(pipe([0,0,0],[1,0,0],850,De65,Di65),"TUBE_ASPIRATION_DN65")
d.comp(top,pump_l)
t=gp_Trsf(); t.SetTranslation(v([-1000,0,0])); d.comp(top,asp,t)
# sous-ensemble de refoulement (repère local : axe Z depuis l'origine)
sub=d.asm("LIGNE_REFOULEMENT")
tub=d.part(pipe([0,0,0],[0,0,1],300,De50,Di50),"TUBE_DN50_L300")
valve=cut(BRepPrimAPI_MakeCylinder(gp_Ax2(P([0,0,300]),D([0,0,1])),45,120).Shape(),
          BRepPrimAPI_MakeCylinder(gp_Ax2(P([0,0,299]),D([0,0,1])),Di50/2,122).Shape())
val=d.part(valve,"VANNE_V1")
d.comp(sub,tub,None,"TUBE_AVANT_VANNE")
d.comp(sub,val)
t2=gp_Trsf(); t2.SetTranslation(v([0,0,420])); d.comp(sub,tub,t2,"TUBE_APRES_VANNE")
# le sous-ensemble est placé en sortie de refoulement (z=125)
t3=gp_Trsf(); t3.SetTranslation(v([0,0,125])); d.comp(top,sub,t3)
d.write(OUT+"/ref3_assemblage_pompe_vanne.stp")
truth["ref3"]={"tubes":[{"Di":Di65,"De":De65,"L":850},{"Di":Di50,"L":300},{"Di":Di50,"L":300}],
  "equipements":{"POMPE_CIRC_P1":{"DN_asp":Di65,"DN_ref":Di50},"VANNE_V1":{"DN":Di50}},
  "extremites":2}
json.dump(truth, open(OUT+"/verite.json","w"), indent=1)
print("ok")
