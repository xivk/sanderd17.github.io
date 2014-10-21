// vim: tabstop=4:softtabstop=4:shiftwidth=4:noexpandtab

var overpassapi = "http://overpass-api.de/api/interpreter?data=";

var crabInfo = {};
var osmInfo = [];
var missingAddr;
var missingNoPosAddr;
var wrongAddr;
var streets = {};
var finished = [];

var tableId = "streetsTable"

function getPcode()
{
	return document.getElementById("pcodeInput").value;
}

function getMaxDist()
{
	return +document.getElementById("distanceInput").value;
}

function loadOsmData()
{
	return document.getElementById("osmLoadInput").checked;
}

function readPcode()
{
	if (!getPcode())
		return;
	document.title = getPcode() + " Addr Import";
	var req = new XMLHttpRequest();
	req.overrideMimeType("application/json");
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		var data = JSON.parse(req.responseText);
		streets = data.streets;
		var html = 
			'<tr>\n' +
			'<th title="Name of the street">Name</th>\n' +
			'<th title="Total number of housenumbers">Total</th>\n' +
			'<th title="Number of regular housenumbers not present in OSM">Missing</th>\n' +
			'<th title="Housenumbers that don\'t have a position in CRAB, and are not present in OSM">Missing w/o pos</th>\n' +
			'<th title="Housenumbers in OSM but without match in CRAB">Wrong</th>\n' +
			'</tr>\n';
		for (var i = 0; i < streets.length; i++)
		{
			var street = streets[i];
			html += '<tr id="' + street.sanName + '">\n';
			html += '<td id="' + street.sanName + '-name">\n' + street.name + '\n</td>\n';
			html += '<td id="' + street.sanName + '-total"></td>\n';
			html += '<td id="' + street.sanName + '-missing"></td>\n';
			html += '<td id="' + street.sanName + '-missing-nopos"></td>\n';
			html += '<td id="' + street.sanName + '-wrong"></td>\n';
			html += '</tr>\n';
		}
		document.getElementById(tableId).innerHTML = html;
		updateData();
	}
	req.open("GET", getPcode() + ".json", true);
	req.send(null);
}

/**
 * Add the street info for that certain streetname to the context object
 */
function getCrabInfo(num) {
	finished[num] = false;
	var sanName = streets[num].sanName;

	var req = new XMLHttpRequest();
	req.overrideMimeType("application/json");
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		var data = JSON.parse(req.responseText);

		crabInfo[sanName] = data.addresses;
		document.getElementById(sanName + '-total').innerHTML = 
			getCellHtml("crabInfo", num, "-full");

		finished[num] = true;
		finishLoading();
	};
	req.open("GET", getPcode() + "/" + sanName + ".json", true);
	req.send(null);
}


function updateData()
{
	crabInfo = {};
	for (var i = 0; i < streets.length; i++)
	{
		var sanName = streets[i].sanName;
		document.getElementById(sanName + "-total").innerHTML = "Loading...";
		if (loadOsmData())
		{
			document.getElementById(sanName + "-missing").innerHTML = "Loading...";
			document.getElementById(sanName + "-missing-nopos").innerHTML = "Loading...";
			document.getElementById(sanName + "-wrong").innerHTML = "Loading...";
		}
		// Also import the actual CRAB data
		getCrabInfo(i);
	}
	// Load osm data
	if (loadOsmData())
		getOsmInfo();
}

/**
 * Check if everything is loaded, then finish everything
 */
function finishLoading()
{
	if (!loadOsmData())
		return; // don't compare if you don't load anything
	if (finished.every(function(d) { return d; }))
		compareData();
}

/**
 * Get the data from osm, ret should be an empty array
 */
function getOsmInfo() {
	finished[streets.length] = false;
	var query = 
		'[out:json];'+
		'area["boundary"="administrative"]["addr:postcode"="' + getPcode() + '"]->.area;'+
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
		finished[streets.length] = true;
		finishLoading();
	}
	req.open("GET", overpassapi + encodeURIComponent(query), true);
	req.send(null);
}

/**
 * Makes the html code for a table cell (including links tooltip, ...)
 */
function getCellHtml(obj, streetIdx, layerSuffix, msg)
{
	var sanName = streets[streetIdx].sanName;
	if (msg)
		msg = '"' + msg + '"';
	return "<a href='#' title='Load this data in JOSM' onclick='openInJosm(%obj[\"%street\"], streets[%i], \"%layerName\", %msg)' >%num</a>"
		.replace("%obj", obj)
		.replace("%street", sanName)
		.replace("%i", streetIdx)
		.replace("%layerName", sanName + layerSuffix)
		.replace("%msg", msg)
		.replace("%num", window[obj][sanName].length);
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
		document.getElementById(street.sanName + '-missing').innerHTML = 
			getCellHtml("missingAddr", i, "-missing");

		document.getElementById(street.sanName + '-missing-nopos').innerHTML = 
			getCellHtml("missingNoPosAddr", i, "-missing-noPos");

		document.getElementById(street.sanName + '-wrong').innerHTML = 
			getCellHtml("wrongAddr", i, "-wrong", "Housenumber not found in CRAB, or not close enough ");
	}
}

function compareHnr(source, comp) {
	var diffList = [];
	var maxDist = getMaxDist();
	for (var i = 0; i < source.length; i++)
	{
		// also match double housenumbers "42-44" with single ones "44"
		var housenumberList = source[i].housenumber.split("-");
		var match = true;
		for (var j = 0; j < housenumberList.length; j++)
		{
			var re = new RegExp("-?" + housenumberList[j] + "-?");
			// find a housenumber in the comparison list that matches (probably partially)
			match = match && comp.find( function (addr) {
				var test = re.test(addr.housenumber);
				if (!test)
					return false;
				if (!maxDist)
					return true;
				// Also test the distance if the housenumbers match and a distance is given
				return getAddrDistance(source[i], addr) < maxDist;
			});
		}
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
		var msg = message;
		if (!lat || !lon)
		{
			lat = (streetData.latmax + streetData.latmin) / 2;
			lon = (streetData.lonmax + streetData.lonmin) / 2;
			msg += "Position not found in CRAB. Please map with care."
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

/**
 * Calculate the distance between two address objects
 * @returns -1 if one of the addresses is either missing lat or lon
 * @returns the approx spherical distance otherwise
 */
function getAddrDistance(addr1, addr2)
{
	if (!addr1.lat || !addr2.lat || !addr1.lon || !addr2.lon)
		return -1;
	var R = 6.371e6; // Radius of the earth in m
	var dLat = (addr2.lat-addr1.lat) * Math.PI/180;
	var dLon = (addr2.lon-addr1.lon) * Math.PI/180; 
	var a = 
		0.5 - Math.cos(dLat)/2 +
		(0.5 - Math.cos(dLon)/2) *
		Math.cos(addr1.lat * Math.PI/180) *
		Math.cos(addr2.lat * Math.PI/180);
	return R * 2 * Math.asin(Math.sqrt(a)); // Distance in m
}

// Read the URL stuff to set stuff
var query = window.location.search.substring(1);
var vars = query.split("&");
for (var i = 0; i < vars.length; i++)
{
	var kv = vars[i].split("=");
	if (kv[1] == "true")
		document.getElementById(kv[0]).checked = true;
	else if (kv[1] == "false")
		document.getElementById(kv[0]).checked = false;
	else
		document.getElementById(kv[0]).value = kv[1];
}

readPcode();
