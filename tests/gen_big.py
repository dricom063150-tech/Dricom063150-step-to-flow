import math, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.argv = ['x', str(HERE / 'fixtures')]
exec((HERE / 'gen_steps.py').read_text().split("truth={}")[0])
d=Doc(); top=d.asm("SERPENTIN_200")
De,Di=60.3,52.48; R=1.5*Di; L=400; n=100
x=0;y=0; dirx=1
parts={}
pp=d.part(pipe([0,0,0],[1,0,0],L,De,Di),"TUBE_L400")
b1=d.part(bend([0,0,R],[0,0,1],[0,-1,0],R,De,Di,180),"COUDE_180")  # placé par transformation
for i in range(n):
    t=gp_Trsf(); 
    if dirx>0: t.SetTranslation(v([0,y,0]))
    else:
        r=gp_Trsf(); r.SetRotation(gp_Ax1(P([0,0,0]),D([0,0,1])),math.pi); tt=gp_Trsf(); tt.SetTranslation(v([L,y,0])); t=tt.Multiplied(r)
    d.comp(top,pp,t)
    if i<n-1:
        tb=gp_Trsf()
        if dirx>0: tb.SetTranslation(v([L,y+R,-R]))
        else:
            r=gp_Trsf(); r.SetRotation(gp_Ax1(P([0,0,0]),D([0,0,1])),math.pi); tt=gp_Trsf(); tt.SetTranslation(v([0,y+R,-R])); tb=tt.Multiplied(r)
        d.comp(top,b1,tb)
    y+=2*R; dirx=-dirx
d.write(str(HERE / "fixtures" / "ref5_serpentin_199.stp")); print('ok')
