#!/bin/zsh
# Downloads OpenStreetMap data for Munich via the Overpass API into raw/
set -e
OUT="$(cd "$(dirname "$0")/.." && pwd)/raw"
BB="48.045,11.34,48.265,11.745"
API=https://overpass-api.de/api/interpreter
q() { # name, query
  echo "fetching $1 ..."
  curl -sS -m 600 -A "munich-living-compare/0.1" --data-urlencode "data=$2" "$API" -o "$OUT/$1"
  ls -la "$OUT/$1"
  sleep 5
}
q pois.tsv "[out:csv(::type,::id,::lat,::lon,amenity,shop,leisure,tourism,healthcare,sport,access,name,brand;true;\"\t\")][timeout:300][bbox:$BB];
(
 nwr[amenity~\"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|biergarten|nightclub|pharmacy|doctors|dentist|clinic|post_office|bank|atm|cinema|theatre|library|arts_centre|music_venue|concert_hall|marketplace)$\"];
 nwr[shop];
 nwr[leisure~\"^(fitness_centre|sports_centre|swimming_pool|ice_rink)$\"][name];
 nwr[leisure=fitness_centre];
 nwr[tourism~\"^(museum|gallery)$\"];
 nwr[healthcare];
 nwr[amenity=post_box];
);
out center;"
q transit.json "[out:json][timeout:300][bbox:$BB];
(
 rel[type=route][route~\"^(subway|light_rail|train|tram|bus)$\"];
)->.r;
.r out body;
node(r.r);
out;
(
 node[railway~\"^(station|halt|tram_stop)$\"];
 node[station=subway];
);
out;"
