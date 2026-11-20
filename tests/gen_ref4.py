import math, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.argv = ['x', str(HERE / 'fixtures')]
exec((HERE / 'gen_steps.py').read_text().split("truth={}")[0])
from OCP.gp import gp_Ax1
OUT=str(HERE / 'fixtures')
d=Doc(); top=d.asm("CAS_AVANCES")
De1,Di1=114.3,102.26; De5,Di5=60.3,52.48
R=1.5*Di5
# a) tube cintré monobloc : tube 300 + coude 90 + tube 200 fusionnés
a1=pipe([0,0,0],[1,0,0],300,De5,Di5); a2=bend([300,0,R],[0,-1,0],[0,0,-1],R,De5,Di5,90); a3=pipe([300+R,0,R],[0,0,1],200,De5,Di5)
d.comp(top,d.part(fuse(fuse(a1,a2),a3),"TUBE_CINTRE_MONOBLOC"))
# b) piquage soudé : collecteur DN100 + piquage DN50 à mi-longueur
y0=500
d.comp(top,d.part(pipe([0,y0,0],[1,0,0],1000,De1,Di1),"COLLECTEUR_DN100"))
d.comp(top,d.part(pipe([500,y0+De1/2,0],[0,1,0],300,De5,Di5),"PIQUAGE_DN50"))
# collier sur le collecteur
d.comp(top,d.part(pipe([200,y0,0],[1,0,0],40,De1+20,De1),"COLLIER_SUPPORT"))
# bride + perçages en bout de collecteur (x=1000..1020)
fl=pipe([1000,y0,0],[1,0,0],20,220,Di1)
for k in range(8):
    a=2*math.pi*k/8
    fl=cut(fl,BRepPrimAPI_MakeCylinder(gp_Ax2(P([999,y0+90*math.cos(a),90*math.sin(a)]),D([1,0,0])),9,22).Shape())
d.comp(top,d.part(fl,"BRIDE_DN100"))
# d) élargissement brusque DN100 -> DN50 ? : DN50 après la bride
d.comp(top,d.part(pipe([1020,y0,0],[1,0,0],300,De5,Di5),"TUBE_DN50_APRES_BRIDE"))
# c) onglet : deux tubes se rejoignant à angle droit au point (0,1200,0)
d.comp(top,d.part(pipe([-400,1200,0],[1,0,0],400,De5,Di5),"TUBE_ONGLET_A"))
d.comp(top,d.part(pipe([0,1200,0],[0,1,0],300,De5,Di5),"TUBE_ONGLET_B"))
# f) tube plein (diamètre extérieur seul) DN25
d.comp(top,d.part(BRepPrimAPI_MakeCylinder(gp_Ax2(P([0,1600,0]),D([1,0,0])),33.4/2,400).Shape(),"TUBE_PLEIN_DN25"))
# g) réservoir avec tube de sortie
d.comp(top,d.part(box_equipment(400,1500,-200,400,300,400),"RESERVOIR_R1"))
# i) sous-ensemble tourné de 30° autour de Z : tube 500 dans l'axe X local
sub=d.asm("SOUS_ENS_TOURNE"); d.comp(sub,d.part(pipe([0,0,0],[1,0,0],500,De5,Di5),"TUBE_TOURNE"))
t=gp_Trsf(); t.SetRotation(gp_Ax1(P([0,0,0]),D([0,0,1])),math.radians(30)); t2=gp_Trsf(); t2.SetTranslation(v([2000,0,0])); d.comp(top,sub,t2.Multiplied(t))
d.write(OUT+"/ref4_cas_avances.stp")
print("ok")
