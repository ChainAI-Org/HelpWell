from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
PURPLE='#7A3BEB'
GRAY='#34363B'
# Shared geometry: e's enclosed counter and both eyes. No approximations.
EYE='M 0 18 C 3 7 11 0 24 0 C 37 0 45 7 48 18 Z'
P_OUTER='M 28 0 H 76 C 94 0 104 11 104 29 V 75 C 104 94 93 104 76 104 H 29 L 7 128 Q 0 135 0 125 V 29 C 0 11 10 0 28 0 Z'
P_INNER='M 39 26 H 65 Q 78 26 78 39 V 65 Q 78 78 65 78 H 39 Q 26 78 26 65 V 39 Q 26 26 39 26 Z'
E_OUTER='M 52 36 C 83 36 104 58 104 88 V 94 Q 104 98 100 98 H 27 C 31 112 41 120 55 120 C 66 120 74 116 81 109 L 100 120 C 89 135 73 143 53 143 C 22 143 0 120 0 89 C 0 58 22 36 52 36 Z'
H='M 4 0 H 22 Q 26 0 26 4 V 55 H 76 V 4 Q 76 0 80 0 H 98 Q 102 0 102 4 V 136 Q 102 140 98 140 H 80 Q 76 140 76 136 V 80 H 26 V 136 Q 26 140 22 140 H 4 Q 0 140 0 136 V 4 Q 0 0 4 0 Z'
L='M 4 0 H 22 Q 26 0 26 4 V 136 Q 26 140 22 140 H 4 Q 0 140 0 136 V 4 Q 0 0 4 0 Z'
W='M 4 0 H 24 Q 28 0 29 4 L 54 94 L 80 4 Q 81 0 85 0 H 100 Q 104 0 105 4 L 131 94 L 156 4 Q 157 0 161 0 H 180 Q 185 0 183 5 L 145 136 Q 144 140 139 140 H 121 Q 117 140 116 136 L 92 53 L 68 136 Q 67 140 63 140 H 45 Q 41 140 40 136 L 1 5 Q -1 0 4 0 Z'

def path(d,fill,transform=''):
    return f'<path d="{d}" fill="{fill}"'+(f' transform="{transform}"' if transform else '')+'/>'
def defs():
    return f'<defs><path id="e-counter" d="{EYE}"/><mask id="e-cut" maskUnits="userSpaceOnUse" x="-2" y="-2" width="110" height="150"><rect x="-2" y="-2" width="110" height="150" fill="white"/><use href="#e-counter" transform="translate(28 59)" fill="black"/></mask></defs>'
def bubble(color,face=False,white=False):
    result=f'<path d="{P_OUTER} {P_INNER}" fill="{color}" fill-rule="evenodd"/>'
    if face:
        # Same canonical e counter, uniformly scaled to 17.28 x 6.48.
        if white:
            result=path(P_OUTER,color)+path(P_INNER,'#FFFFFF')
        result+=f'<use href="#e-counter" fill="{color}" transform="translate(31.36 49) scale(.36)"/><use href="#e-counter" fill="{color}" transform="translate(55.36 49) scale(.36)"/>'
    return result
def wordmark(help_color=PURPLE,well_color=GRAY):
    out=''
    positions=[('H',0),('e',116),('l',234),('p',276),('W',393),('e',590),('l',708),('l',750)]
    for letter,x in positions:
        color=help_color if x<393 else well_color
        if letter=='e': glyph=f'<g mask="url(#e-cut)">{path(E_OUTER,color)}</g>'
        elif letter=='p': glyph=f'<g transform="translate(0 36)">{bubble(color)}</g>'
        else: glyph=path({'H':H,'l':L,'W':W}[letter],color)
        out+=f'<g transform="translate({x} 0)">{glyph}</g>'
    return out
def svg(body,w,h,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{title}"><title>{title}</title>{defs()}{body}</svg>'
assets={}
for name,a,b in [('primary',PURPLE,GRAY),('purple',PURPLE,PURPLE),('charcoal',GRAY,GRAY),('black','#000000','#000000'),('white','#FFFFFF','#FFFFFF'),('dark-background',PURPLE,'#FFFFFF')]:
    assets['helpwell-wordmark-'+name]=svg('<g transform="translate(24 24)">'+wordmark(a,b)+'</g>',824,216,'HelpWell logo')
for name,color,face in [('purple',PURPLE,True),('charcoal',GRAY,True),('black','#000000',True),('white','#FFFFFF',False)]:
    # Transparent counters for monochrome; explicit white face for primary.
    body=bubble(color,True,face)
    assets['helpwell-widget-'+name]=svg('<g transform="translate(24 11)">'+body+'</g>',152,152,'HelpWell support')
assets['helpwell-mark-purple']=svg('<g transform="translate(24 11)">'+bubble(PURPLE)+'</g>',152,152,'HelpWell chat mark')
for name,data in assets.items():
    (ROOT/'svg'/f'{name}.svg').write_text(data)

def label(x,y,text,size=16,color=GRAY):
    return f'<text x="{x}" y="{y}" font-family="DejaVu Sans,sans-serif" font-size="{size}" fill="{color}">{text}</text>'
board='<rect width="1200" height="940" fill="white"/>'
board+=label(60,65,'HelpWell · Final identity',24)
board+=label(60,99,'Purple #7A3BEB  /  Charcoal #34363B',16)
board+='<g transform="translate(120 155) scale(1.22)">'+wordmark()+'</g>'
board+='<path d="M60 390 H1140" stroke="#E8E8EE"/>'
board+=label(60,435,'Widget · level eyes',18)
board+='<g transform="translate(110 474) scale(1.55)">'+bubble(PURPLE,True,True)+'</g>'
board+=label(450,435,'One shared shape',18)
board+='<g transform="translate(470 485) scale(1.35)">'+f'<g mask="url(#e-cut)">{path(E_OUTER,GRAY)}</g></g>'
board+=f'<use href="#e-counter" fill="{PURPLE}" transform="translate(690 565) scale(1.2)"/>'
board+=label(450,725,'The e counter and both eyes use the same vector path.',15)
board+='<rect x="60" y="780" width="1080" height="120" rx="16" fill="#202126"/>'
board+='<g transform="translate(95 802) scale(.46)">'+wordmark(PURPLE,'#FFFFFF')+'</g>'
board+='<g transform="translate(810 798) scale(.67)">'+bubble('#FFFFFF',True,False)+'</g>'
(ROOT/'preview.svg').write_text(svg(board,1200,940,'HelpWell final identity preview'))
(ROOT/'source'/'geometry.json').write_text(json.dumps({'purple':PURPLE,'charcoal':GRAY,'eye_and_e_counter_path':EYE,'eye_scale':0.36,'eye_ratio':48/18,'p_outer_path':P_OUTER,'p_counter_path':P_INNER},indent=2))
print('Wrote',len(assets),'SVG assets and preview')
