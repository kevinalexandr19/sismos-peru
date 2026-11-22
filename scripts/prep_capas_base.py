# One-off script used to build the static layers in data/ (run once; paths point to local downloads:
# GEM gem_active_faults_harmonized.geojson, PB2002 boundaries, Natural Earth 10m populated places and roads).
import geopandas as gpd, json
from shapely.geometry import box
D='/home/claude/dl/'; O='/home/claude/sismos-peru/data/'
bb = box(-84, -21, -66, 1.5)
f = gpd.read_file(D+'gem.geojson')
print(len(f), list(f.columns))
f = f[f.intersects(bb)].copy()
f['geometry'] = f.geometry.simplify(0.003)
keep=[c for c in ['name','slip_type','net_slip_rate','average_dip','dip_dir','upper_seis_depth','catalog_name','last_movement','activity_confidence','epistemic_quality'] if c in f.columns]
f=f[keep+['geometry']]
print(len(f)); print(f.drop(columns='geometry').head(8).to_string())
f.to_file(O+'fallas_activas.geojson', driver='GeoJSON', COORDINATE_PRECISION=4)
d = gpd.read_file(D+'dep.geojson')[['NOMBDEP','geometry']]
d['geometry']=d.geometry.simplify(0.004)
d.to_file(O+'departamentos.geojson', driver='GeoJSON', COORDINATE_PRECISION=4)
print(len(d), sorted(d.NOMBDEP))
p = gpd.read_file(D+'plates.json')
p = p[p.intersects(box(-95,-30,-60,10))]
p.to_file(O+'placas.geojson', driver='GeoJSON', COORDINATE_PRECISION=3); print(p.columns.tolist(), len(p))
