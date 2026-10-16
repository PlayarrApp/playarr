const validate = (id, kind, marker) => {
  if (kind !== "movie" && kind !== "series") throw new Error("invalid Sailfish detail kind");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid Sailfish detail id");
  if (!/^--pc=[a-f0-9]{8}$/.test(marker)) throw new Error("invalid Sailfish route marker");
};

export function detailRouteRequest(id, kind, marker) {
  validate(id, kind, marker);
  return `js:Api.request('GET','/api/v1/catalog/${id}',null,function(st,d){if(st!==200){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}if(!d){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}if(!d.work){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}if(d.work.kind!=='${kind}'){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}if(d.work.id!=='${id}'){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}pageStack.currentPage.open(d.work);})`;
}
