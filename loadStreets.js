
var dataSite = "https://raw.githubusercontent.com/sanderd17/flanders_addr_export/master/";
var overpassapi = "http://overpass-api.de/api/interpreter?data=";

var crabInfo;
var osmInfo;
var missingAddr;
var wrongAddr;
var streets;

/**
 * Add the street info for that certain streetname and pcode to the context object
 */
function addCrabInfo(sanName, pcode, crabInfo) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		if (req.status != 200)
			return;
		var data = JSON.parse(req.responseText);

		if (!crabInfo[data.pcode])
		crabInfo[data.pcode] = {};
		crabInfo[data.pcode][data.name] = data.addresses;
	};
	req.open("GET", dataSite + pcode + "/" + sanName + ".json", true);
	req.send(null);
}


function createDocument(pcode, id)
{
	var html = '<h1>Address import ' + pcode + '</h1>\n';
	html += '<table id="' + pcode + '-table">\n';
	html += '<tr><th>Name</th><th>Total</th><th>Missing</th><th>Wrong</th></tr>\n';
	for (var i = 0; i < streets.length; i++)
	{
		var street = streets[i];
		html += '<tr id="' + pcode + '-' + street.sanName + '">\n';
		html += '<td id="' + pcode + '-' + street.sanName + '-name">\n' + street.name + '\n</td>\n';
		html += '<td id="' + pcode + '-' + street.sanName + '-total"></td>\n';
		html += '<td id="' + pcode + '-' + street.sanName + '-missing"></td>\n';
		html += '<td id="' + pcode + '-' + street.sanName + '-wrong"></td>\n';
		html += '</tr>\n';
		// Also import the actual CRAB data
		if (!crabInfo)
			crabInfo = {};
		addCrabInfo(street.sanName, pcode, crabInfo);
	}
	document.getElementById(id).innerHTML = html;
	// Load osm data
	if (!osmInfo)
		osmInfo = [];
	getOsmInfo(pcode, osmInfo);
}

/**
 * Get the data from osm, ret should be an empty array
 */
function getOsmInfo(pcode, osmInfo) {
	var query = [
/*		'[out:json];',
		'area["boundary"="administrative"]["addr:postcode"="' + pcode + '"]->.area;',
		'(',
			'node["addr:housenumber"](area.area);',
			'way["addr:housenumber"](area.area);',
			'relation["addr:housenumber"](area.area);',
		');',*/
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
			addr.street = data[i].tags["addr:street"];
			osmInfo.push(addr);
		}
		compareData();
	}
	req.open("GET", overpassapi + encodeURIComponent(query), true);
	req.send(null);
}

/**
 * This function assumes all crab data and the osm data is loaded
 */
function compareData() {
	missingAddr = {};
	wrongAddr = {};
	for (var i = 0; i < streets.length; i++)
	{
		var street = streets[i];
		if (!missingAddr[street.pcode])
		{
			missingAddr[street.pcode] = {};
			wrongAddr[street.pcode] = {};
		}

		// get the list with all housenumbers in this street from the two sources
		var crabStreet = crabInfo[street.pcode][street.sanName];
		var re = new RegExp("^" + street.name.replace(".",".*") + "$");
		var osmStreet = osmInfo.filter(function(addr) {
			return re.test(addr.street);
		});

		// Matches in one direction
		missingAddr[street.pcode][street.sanName] = compareHnr(crabStreet, osmStreet);
		wrongAddr[street.pcode][street.sanName] = compareHnr(osmStreet, crabStreet);

		document.getElementById(street.pcode + '-' + street.sanName + '-total').innerHTML = crabStreet.length;
		document.getElementById(street.pcode + '-' + street.sanName + '-missing').innerHTML = missingAddr[street.pcode][street.sanName].length;
		document.getElementById(street.pcode + '-' + street.sanName + '-wrong').innerHTML = wrongAddr[street.pcode][street.sanName].length;
	}
}

function compareHnr(source, comp) {
	var diffList = []
	for (var i = 0; i < source.length; i++)
	{
		var housenumber = source[i].housenumber;
		var match = comp.find( function (addr) {
			return addr.housenumber == housenumber;
		});
		if (!match)
			diffList.push(source[i]);
	}
	return diffList;
}
