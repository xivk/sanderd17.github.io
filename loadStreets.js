
var overpassapi = "http://overpass-api.de/api/interpreter?data=";

var crabInfo = {};
var osmInfo = [];
var missingAddr;
var wrongAddr;
var streets; // var filled by the inline script in the pcode.html page
var finished = {};

/**
 * Add the street info for that certain streetname and pcode to the context object
 */
function addCrabInfo(sanName, pcode, crabInfo) {
	var req = new XMLHttpRequest();
	req.overrideMimeType("application/json");
	req.onreadystatechange = function()
	{
		if (req.readyState != 4)
			return;
		var data = JSON.parse(req.responseText);

		if (!crabInfo[data.pcode])
			crabInfo[pcode] = {};
		crabInfo[pcode][sanName] = data.addresses;
		finished[sanName] = true;
		finishLoading(pcode);
	};
	req.open("GET", pcode + "/" + sanName + ".json", true);
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
		finished[street.sanName] = false;
		addCrabInfo(street.sanName, pcode, crabInfo);
	}
	document.getElementById(id).innerHTML = html;
	// Load osm data
	finished["#osm"] = false;
	getOsmInfo(pcode, osmInfo);
}

/**
 * Check if everything is loaded, then finish everything
 */
function finishLoading(pcode)
{
	for (var k in finished)
		if (!finished[k])
			return;
	compareData(pcode);
}

/**
 * Get the data from osm, ret should be an empty array
 */
function getOsmInfo(pcode, osmInfo) {
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
			addr.street = data[i].tags["addr:street"];
			osmInfo.push(addr);
		}
		finished["#osm"] = true;
		finishLoading(pcode);
	}
	req.open("GET", overpassapi + encodeURIComponent(query), true);
	req.send(null);
}

/**
 * This function assumes all crab data and the osm data is loaded
 */
function compareData(pcode) {
	missingAddr = {};
	wrongAddr = {};
	for (var i = 0; i < streets.length; i++)
	{
		var street = streets[i];
		if (!missingAddr[pcode])
		{
			missingAddr[pcode] = {};
			wrongAddr[pcode] = {};
		}

		// get the list with all housenumbers in this street from the two sources
		var crabStreet = crabInfo[pcode][street.sanName];
		var re = new RegExp("^" + street.name.replace(".",".*") + "$");
		var osmStreet = osmInfo.filter(function(addr) {
			return re.test(addr.street);
		});
		
		// Matches in one direction
		missingAddr[pcode][street.sanName] = compareHnr(crabStreet, osmStreet);
		wrongAddr[pcode][street.sanName] = compareHnr(osmStreet, crabStreet);


		// Create links like
		// <a href="URI" download="file.osm">n</a>
		var dataURI =  getOsmURI(crabInfo[pcode][street.sanName]);
		document.getElementById(pcode + '-' + street.sanName + '-total').innerHTML = 
			'<a href="' + dataURI + '" download="' + street.sanName + '_full.osm">' + crabStreet.length + '</a>';
		dataURI =  getOsmURI(missingAddr[pcode][street.sanName]);
		document.getElementById(pcode + '-' + street.sanName + '-missing').innerHTML = 
			'<a href="' + dataURI + '" download="' + street.sanName + '_missing.osm">' + missingAddr[pcode][street.sanName].length + '</a>';
		dataURI =  getOsmURI(wrongAddr[pcode][street.sanName]);
		document.getElementById(pcode + '-' + street.sanName + '-wrong').innerHTML = 
			'<a href="' + dataURI + '" download="' + street.sanName + '_wrong.osm">' + wrongAddr[pcode][street.sanName].length + '</a>';
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

function getOsmURI(data, message)
{
	var timeStr = (new Date()).toISOString();
	var str = 'data:text/xml;charset=utf-8,';
	str += "<?xml version='1.0' encoding='utf-8'?>";
	str += "<osm version='0.6' generator='flanders-addr-import'>\n";
	for (var i = 0; i < data.length; i++)
	{
		var addr = data[i];
		if (!addr.lat)
			continue;
		str += "  <node id='" + (-i-1) + "' lat='" + addr.lat + "' lon='" + 3.2346396 + "' version='0' timestamp='" + timeStr + "' uid='1' user=''>\n";
		str += "    <tag k='addr:housenumber' v='" + addr.housenumber + "'/>\n";
		str += "    <tag k='addr:street' v='" + addr.street + "'/>\n";
		if (message)
			str += "    <tag k='fixme' v='" + message + "'/>\n";
		str += "  </node>\n";
	}
	str += "</osm>\n";
	return str;
}
