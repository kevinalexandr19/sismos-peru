# One-off script used to build the static layers in data/ (run once; paths point to local downloads:
# GEM gem_active_faults_harmonized.geojson, PB2002 boundaries, Natural Earth 10m populated places and roads).
import geopandas as gpd, json
O='/home/claude/sismos-peru/data/'
peru=gpd.read_file(O+'departamentos.geojson').union_all().buffer(0.05)
r=gpd.read_file('ne_10m_roads.geojson', bbox=(-82,-19,-68,0))
print(r['type'].value_counts().to_dict())
r=r[r.intersects(peru)].copy(); r['geometry']=r.intersection(peru)
r=r[~r.is_empty]
def cls(row):
    if row['expressway']==1: return 'autopista'
    if row['type']=='Major Highway': return 'autopista'
    if row['scalerank']<=4: return 'principal'
    return 'secundaria'
r['clase']=r.apply(cls,axis=1)
r['nombre']=r['name'].fillna('')
r['geometry']=r.geometry.simplify(0.002)
r=r[['clase','nombre','geometry']]; print(r.clase.value_counts().to_dict(), r[r.nombre!=''].nombre.unique()[:20])
r.to_file(O+'carreteras.geojson',driver='GeoJSON',COORDINATE_PRECISION=4)
c=gpd.read_file('ne_10m_populated_places_simple.geojson'); c=c[c.adm0name=='Peru'].copy()
MAIN_EXTRA={'Chimbote','Juliaca','Sullana','Tarapoto','Chincha Alta'}
c['rango']=c.apply(lambda x: 'principal' if (x.featurecla in('Admin-0 capital','Admin-1 capital') and x['name']!='Huaura') or x['name'] in MAIN_EXTRA else 'secundaria',axis=1)
c['capital']=c.featurecla.map({'Admin-0 capital':'Capital nacional','Admin-1 capital':'Capital regional'}).fillna('')
c.loc[c.name=='Huaura','capital']=''; c.loc[c.name=='Callao','capital']='Capital regional'
c=c[['name','rango','capital','pop_max','geometry']].rename(columns={'name':'nombre','pop_max':'pob'})
c.loc[c.nombre=='Tarapoto','pob']=None  # Natural Earth value (936) is clearly wrong
c=c[c.pob.isna() | (c.pob>=1000)]
c=c.sort_values('pob',ascending=False)
print(c.rango.value_counts().to_dict())
c.to_file(O+'ciudades.geojson',driver='GeoJSON',COORDINATE_PRECISION=4)
