// vim: tabstop=4:softtabstop=4:shiftwidth=4:noexpandtab

var overpassapi = "http://overpass-api.de/api/interpreter?data=";

var crabInfo = {};
var osmInfo = [];
var missingAddr;
var missingNoPosAddr;
var wrongAddr;
var streets = {};
var finished = {};
// Get the pcode from the URL query
var pcode = window.location.search.substring(1,5);

var tableId = "streetsTable"

function addStreetList()
{
	var req = new XMLHttpRequest();
	req.overrideMimeType("application/json");
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		var data = JSON.parse(req.responseText);
		streets = data.streets;
		var html = "";
		for (var i = 0; i < streets.length; i++)
		{
			var street = streets[i];
			var idPart = pcode + '-' + street.sanName;
			html += '<tr id="' + idPart + '">\n';
			html += '<td id="' + idPart + '-name">\n' + street.name + '\n</td>\n';
			html += '<td id="' + idPart + '-total"></td>\n';
			html += '<td id="' + idPart + '-missing"></td>\n';
			html += '<td id="' + idPart + '-missing-nopos"></td>\n';
			html += '<td id="' + idPart + '-wrong"></td>\n';
			html += '</tr>\n';
		}
		document.getElementById(tableId).innerHTML += html;
	}
	req.open("GET", pcode + ".json", true);
	req.send(null);
}

/**
 * Add the street info for that certain streetname and pcode to the context object
 */
function getCrabInfo(sanName) {
	var req = new XMLHttpRequest();
	req.overrideMimeType("application/json");
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		var data = JSON.parse(req.responseText);

		crabInfo[sanName] = data.addresses;
		finished[sanName] = true;
		finishLoading();
	};
	req.open("GET", pcode + "/" + sanName + ".json", true);
	req.send(null);
}


function updateData()
{
	crabInfo = {};
	for (var i = 0; i < streets.length; i++)
	{
		var street = streets[i];
		var idPart = pcode + '-' + street.sanName;
		document.getElementById(idPart + "-total").innerHTML += "Loading...";
		document.getElementById(idPart + "-missing").innerHTML += "Loading...";
		document.getElementById(idPart + "-missing-nopos").innerHTML += "Loading...";
		document.getElementById(idPart + "-wrong").innerHTML += "Loading...";
		// Also import the actual CRAB data
		finished[street.sanName] = false;
		getCrabInfo(street.sanName);
	}
	// Load osm data
	finished["#osm"] = false;
	getOsmInfo();
}

/**
 * Check if everything is loaded, then finish everything
 */
function finishLoading()
{
	for (var k in finished)
		if (!finished[k])
			return;
	compareData();
}

/**
 * Get the data from osm, ret should be an empty array
 */
function getOsmInfo() {
	var query = 
		'[out:json];'+
		'area["boundary"="administrative"]["addr:postcode"="' + pcode + '"]->.area;'+
		'('+
			'node["addr:housenumber"](area.area);'+
			'way["addr:housenumber"](area.area);'+
			'relation["addr:housenumber"](area.area);'+
		');'+
		'out center;'

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
			var d = data[i];
			addr.lat = d.lat || d.center.lat;
			addr.lon = d.lon || d.center.lon;

			// TODO support Associated Street relations as valid?
			if (!d.tags["addr:housenumber"] || !d.tags["addr:street"])
				continue;
			addr.housenumber = d.tags["addr:housenumber"];
			addr.street = d.tags["addr:street"];
			osmInfo.push(addr);
		}
		finished["#osm"] = true;
		finishLoading();
	}
	req.open("GET", overpassapi + encodeURIComponent(query), true);
	req.send(null);
}

/**
 * This function assumes all crab data and the osm data is loaded
 */
function compareData() {
	missingAddr = {};
	missingNoPosAddr = {};
	wrongAddr = {};
	for (var i = 0; i < streets.length; i++)
	{
		var street = streets[i];

		// get the list with all housenumbers in this street from the two sources
		var crabStreet = crabInfo[street.sanName];
		var re = new RegExp("^" + street.name.replace(".",".*") + "$");
		var osmStreet = osmInfo.filter(function(addr) {
			return re.test(addr.street);
		});
		
		// Matches in one direction
		var crabStreetPos = crabStreet.filter(function(addr) {
			return addr.lat && addr.lon;
		});
		var crabStreetNoPos = crabStreet.filter(function(addr) {
			return !addr.lat || !addr.lon;
		});
		missingAddr[street.sanName] = compareHnr(crabStreetPos, osmStreet);
		missingNoPosAddr[street.sanName] = compareHnr(crabStreetNoPos, osmStreet);
		wrongAddr[street.sanName] = compareHnr(osmStreet, crabStreet);


		// Create links
		var getHtml = function(num, obj, street, layerSuffix, msg)
		{
			if (msg)
				msg = '"' + msg + '"';
			return "<a href='#' title='Load this data in JOSM' onclick='openInJosm(%obj[\"%street\"], streets[%i], \"%layerName\", %msg)' >%num</a>"
				.replace("%obj", obj)
				.replace("%street", street)
				.replace("%i", i)
				.replace("%layerName", street + layerSuffix)
				.replace("%msg", msg)
				.replace("%num", num);
		}
		var idPart = pcode + '-' + street.sanName;

		document.getElementById(idPart + '-total').innerHTML = 
			getHtml(crabStreet.length, "crabInfo", street.sanName, "-full");

		document.getElementById(idPart + '-missing').innerHTML = 
			getHtml(missingAddr[street.sanName].length, "missingAddr", street.sanName, "-missing");

		document.getElementById(idPart + '-missing-nopos').innerHTML = 
			getHtml(missingNoPosAddr[street.sanName].length, "missingNoPosAddr", street.sanName, "-missing-noPos", "Position not found in CRAB");

		document.getElementById(idPart + '-wrong').innerHTML = 
			getHtml(wrongAddr[street.sanName].length, "wrongAddr", street.sanName, "-wrong", "Housenumber not found in Crab");
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

function openInJosm(data, streetData, layerName, message)
{
	var timeStr = (new Date()).toISOString();
	var str = "<osm version='0.6' generator='flanders-addr-import'>\n";
	for (var i = 0; i < data.length; i++)
	{
		var addr = data[i];
		// take the precise position when available, else, center on the street
		var lat = addr.lat;
		var lon = addr.lon;
		if (!lat || !lon)
		{
			lat = (streetData.latmax + streetData.latmin) / 2
			lon = (streetData.lonmax + streetData.lonmin) / 2
		}

		str += "<node id='" + (-i-1) + "' lat='" + lat + "' lon='" + lon + "' version='0' timestamp='" + timeStr + "' uid='1' user=''>";
		str += "<tag k='addr:housenumber' v='" + addr.housenumber + "'/>";
		str += "<tag k='addr:street' v='" + addr.street + "'/>";
		if (message)
			str += "<tag k='fixme' v='" + message + "'/>";
		str += "</node>\n";
	}
	str += "</osm>\n";

	var url =  "http://localhost:8111/load_data?new_layer=true&layer_name="+layerName+"&data=";
	console.log(str);
	var req = new XMLHttpRequest();
	window.open(url + encodeURIComponent(str));
}

// EXECUTE
document.title = pcode + " Addr Import";
addStreetList();
