var dataSite = "https://raw.githubusercontent.com/sanderd17/flanders_addr_export/master/";

/**
 * Add the street info for that certain streetname and pcode to the context object
 */
function addCrabInfo(sanName, pcode, data) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		if (req.status != 200)
			return;
		var dnlData = JSON.parse(req.responseText);

		if (!data[dnlData.pcode])
			data[dnlData.pcode] = {};
		data[dnlData.pcode][data.name] = data.addresses;
	};
	req.open("GET", dataSite + pcode + "/" + sanName + "/" + ".json", true)
	req.send(null)
}


/**
 * Get the data from overpass, ret should be an empty array
 */
function getOverpassInfo(pcode, ret) {
	var query = [
		'[out:json];',
		'area["boundary"="administrative"]["addr:postcode"="' + pcode + '"]->.area;',
		'(',
			'node["addr:housenumber"](area.area);',
			'way["addr:housenumber"](area.area);',
			'relation["addr:housenumber"](area.area);',
		');',
		'out center;'
	].join("");
	var req = new XMLHttpRequest();
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		if (req.status != 200)
			return;
		var data = JSON.parse(req.responseText).elements;
		for (var i = 0; i < data.length; i++)
		{
			var addr = {};
			if (data[i].lat)
			{
				addr.lat = data[i].lat;
				addr.lon = data[i].lon;
			}
			else if (data[i].center && data[i].center.lat)
			{
				addr.lat = data[i].center.lat;
				addr.lon = data[i].center.lon;
			}
			else
				continue;
			if (!data[i].tags["addr:housenumber"] || !data[i].tags["addr:street"])
				continue;
			addr.housenumber = data[i].tags["addr:housenumber"];
			addr.street = data[i].tags["addr:street"]
		}
		
	}
	req.open("GET", "http://overpass-api.de/api/interpreter?data" + encodeURIComponent(query), true);
	req.send(null)
}
