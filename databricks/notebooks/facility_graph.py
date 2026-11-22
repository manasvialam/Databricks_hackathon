# Databricks notebook source
# MAGIC %md
# MAGIC # Facility relationship graph
# MAGIC Explores `workspace.facility_finder.graph_nodes` and `graph_edges`: facilities, the services they claim (Strong or Moderate evidence),
# MAGIC districts, the PM-JAY list, shared phone numbers and suspected duplicates. All data comes from the Delta tables, nothing from the app.

# COMMAND ----------

C = "workspace.facility_finder"
display(spark.sql(f"SELECT edge_type, count(*) AS edges FROM {C}.graph_edges GROUP BY 1 ORDER BY 2 DESC"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Hubs: which services and districts connect the most facilities

# COMMAND ----------

display(spark.sql(f"""
SELECT n.label, n.node_type, count(*) AS degree
FROM {C}.graph_edges e JOIN {C}.graph_nodes n ON n.node_id = e.dst
WHERE e.edge_type IN ('OFFERS', 'IN_DISTRICT')
GROUP BY 1, 2 ORDER BY degree DESC LIMIT 25"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Services offered together (co-occurrence)
# MAGIC Which pairs of services appear at the same facility. A pair that is rare in a district points to a gap in referral options.

# COMMAND ----------

pairs = spark.sql(f"""
SELECT c1.service AS a, c2.service AS b, count(*) AS facilities
FROM {C}.facility_claims c1 JOIN {C}.facility_claims c2 ON c1.facility_id = c2.facility_id AND c1.service < c2.service
WHERE c1.level IN ('Strong','Moderate') AND c2.level IN ('Strong','Moderate')
GROUP BY 1, 2""").toPandas()
import matplotlib.pyplot as plt, numpy as np
svc = sorted(set(pairs.a) | set(pairs.b)); idx = {s: i for i, s in enumerate(svc)}
M = np.zeros((len(svc), len(svc)))
for r in pairs.itertuples(): M[idx[r.a], idx[r.b]] = M[idx[r.b], idx[r.a]] = r.facilities
fig, ax = plt.subplots(figsize=(8, 7)); im = ax.imshow(M, cmap="Greens")
ax.set_xticks(range(len(svc)), svc, rotation=90); ax.set_yticks(range(len(svc)), svc); fig.colorbar(im, label="facilities offering both")
ax.set_title("Services offered together"); plt.tight_layout(); display(fig)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Possible merged records: connected components of shared phones and suspected duplicates
# MAGIC Facilities linked by `SHARES_PHONE` or `SAME_DUP_GROUP` may be one place recorded several times, or a chain sharing a call centre.

# COMMAND ----------

links = spark.sql(f"SELECT src, dst FROM {C}.graph_edges WHERE edge_type IN ('SHARES_PHONE', 'SAME_DUP_GROUP')").collect()
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
for r in links: parent[find(r.src)] = find(r.dst)
from collections import defaultdict
groups = defaultdict(list)
for x in list(parent): groups[find(x)].append(x)
big = sorted((g for g in groups.values() if len(g) > 1), key=len, reverse=True)
print(f"{len(big)} connected groups; largest sizes: {[len(g) for g in big[:10]]}")
rows = [(i, fid) for i, g in enumerate(big[:50]) for fid in g]
if rows:
    spark.createDataFrame(rows, "grp INT, facility_id STRING").createOrReplaceTempView("merge_groups")
    display(spark.sql(f"SELECT m.grp, s.name, s.city, s.state, s.merge_suspect_score FROM merge_groups m JOIN {C}.facilities_serving s ON s.facility_id = m.facility_id ORDER BY m.grp, s.name"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Interactive neighbourhood graph
# MAGIC Pick a state and district; the picture shows its facilities, the services they claim and the PM-JAY list.

# COMMAND ----------

dbutils.widgets.text("state", "BIHAR", "State")
dbutils.widgets.text("district", "PATNA", "District")
state, district = dbutils.widgets.get("state").upper(), dbutils.widgets.get("district").upper()
fac = spark.sql(f"""SELECT facility_id, name, facility_trust FROM {C}.facilities_serving
  WHERE upper(state) = '{state}' AND upper(district) = '{district}' ORDER BY facility_trust DESC NULLS LAST LIMIT 50""").collect()
ids = [r.facility_id for r in fac]
lst = ",".join(f"'{i}'" for i in ids) or "''"
edges = spark.sql(f"SELECT src, dst, edge_type FROM {C}.graph_edges WHERE src IN ({lst}) AND edge_type IN ('OFFERS','LISTED_IN_PMJAY')").collect()
import json
nodes = [{"id": r.facility_id, "k": "f", "l": r.name, "t": float(r.facility_trust or 40)} for r in fac]
for d in sorted({e.dst for e in edges}):
    nodes.append({"id": d, "k": "r" if d.startswith("registry") else "s", "l": d.split(":")[1].replace("_", " ")})
data = json.dumps({"nodes": nodes, "edges": [{"s": e.src, "t": e.dst, "y": e.edge_type} for e in edges]})
html = """<canvas id="g" width="900" height="560" style="width:100%;background:#f3f6f4;border-radius:12px"></canvas><script>
const D=__DATA__,W=900,H=560,c=document.getElementById('g'),x=c.getContext('2d');
const N=D.nodes.map((n,i)=>Object.assign(n,{x:450+Math.cos(i)*220,y:280+Math.sin(i*1.7)*160,vx:0,vy:0})),B=new Map(N.map(n=>[n.id,n]));
let f=0;function step(){const k=Math.max(0,1-f/300);for(const a of N)for(const b of N)if(a!==b){const dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+40,F=3000/d2,d=Math.sqrt(d2);a.vx+=dx/d*F*k;a.vy+=dy/d*F*k}
for(const e of D.edges){const a=B.get(e.s),b=B.get(e.t);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)+.1,F=(d-120)*.012*k;a.vx+=dx/d*F;a.vy+=dy/d*F;b.vx-=dx/d*F;b.vy-=dy/d*F}
for(const n of N){n.vx+=(W/2-n.x)*.0016*k;n.vy+=(H/2-n.y)*.0016*k;n.vx*=.82;n.vy*=.82;n.x=Math.min(W-20,Math.max(20,n.x+n.vx));n.y=Math.min(H-20,Math.max(20,n.y+n.vy))}}
function draw(){x.clearRect(0,0,W,H);for(const e of D.edges){const a=B.get(e.s),b=B.get(e.t);if(!a||!b)continue;x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.strokeStyle=e.y=='LISTED_IN_PMJAY'?'#0b63cc':'rgba(19,32,26,.18)';x.lineWidth=e.y=='OFFERS'?1:2;x.stroke()}
for(const n of N){const r=n.k=='f'?5+n.t/14:12;x.beginPath();x.arc(n.x,n.y,r,0,7);x.fillStyle=n.k=='s'?'#ffc20e':n.k=='r'?'#0b63cc':'#0b5d3b';x.fill();x.lineWidth=2;x.strokeStyle='#fff';x.stroke();
if(n.k!='f'){x.fillStyle='#13201a';x.font='700 12px sans-serif';x.textAlign='center';x.fillText(n.l,n.x,n.y-r-5)}}}
(function loop(){step();draw();if(++f<340)requestAnimationFrame(loop)})();</script>
<p style="font:13px sans-serif">Green: facility (size = trust). Blue: PM-JAY list. Yellow: service.</p>""".replace("__DATA__", data)
displayHTML(html)
