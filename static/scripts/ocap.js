/*
	OCAP - Operation Caputre And Playback
	Copyright (C) 2016 Jamie Goodson (aka MisterGoodson) (goodsonjamie@yahoo.co.uk)

	NOTE: This script is written in ES6 and not intended to be used in a live
	environment. Instead, this script should be transpiled to ES5 for
	browser compatibility (including Chrome).


	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

class Entities {
	constructor() {
		this._entities = [];
	};

	add (entity) {
		this._entities.push(entity);
	};

	getAll () {
		return this._entities;
	};

	getById (id) {
		return this._entities[id]; // Assumes entity IDs are always equal to their index in _entities
	};

	getAllByName (name) {
		let matching = [];
		this._entities.forEach(function (entity) {
			if (entity.getName().indexOf(name) > -1) {
				matching.push(entity);
			}
		});
		return matching;
	};
}


var imageSize = null;
var multiplier = null;
var trim = 0; // Number of pixels that were trimmed when cropping image (used to correct unit placement)
var mapMinZoom = null;
var mapMaxNativeZoom = null;
var mapMaxZoom = null; // mapMaxNativeZoom + 3;
var topoLayer = null;
var satLayer = null;
var terrainLayer = null;
var terrainDarkLayer = null;
var contourLayer = null;
var baseLayerControl = null;
var overlayLayerControl = null;
var entitiesLayerGroup = L.layerGroup([]);
var markersLayerGroup = L.layerGroup([]);
var systemMarkersLayerGroup = L.layerGroup([]);
var projectileMarkersLayerGroup = L.layerGroup([]);
var map = null;
var mapDiv = null;
var mapBounds = null;
var worldObject = null;
var mapAvailable = false;
var frameCaptureDelay = 1000; // Delay between capture of each frame in-game (ms). Default: 1000
var playbackMultiplier = 10; // Playback speed. 1 = realtime.
var maxPlaybackMultipler = 60; // Max speed user can set playback to
var minPlaybackMultipler = 1; // Min speed user can set playback to
var playbackMultiplierStep = 1; // Playback speed slider increment value
var playbackPaused = true;
var playbackFrame = 0;
var entityToFollow = null; // When set, camera will follow this unit
var ui = null;
var entities = new Entities();
var groups = new Groups();
var gameEvents = new GameEvents();
var markers = [];
var countEast = 0;
var countWest = 0;
var countGuer = 0;
var countCiv = 0;

// Mission details
var worldName = "";
var missionName = "";
var endFrame = 0;
var missionCurDate = new Date(0);

// Icons
var icons = null;
var followColour = "#FFA81A";
var hitColour = "#FF0000";
var deadColour = "#000000";

const skipAnimationDistance = 222; // 800 kph at 1 sec frame delay, cruise for most planes - objects changing a larger distance than this would represent will be temporarily hidden between frames because it's assumed they're teleporting
let requestedFrame;

function getArguments () {
	// let args = new Object();
	// window.location.search.replace("?", "").split("&").forEach(function (s) {
	// 	let values = s.split("=");
	// 	if (values.length > 1) {
	// 		args[values[0]] = values[1].replace(/%20/g, " ");
	// 	}
	// });

	let args = new URLSearchParams(window.location.search);


	// console.log(args);
	return args;
}

function initOCAP () {
	mapDiv = document.getElementById("map");
	defineIcons();
	ui = new UI();

	const args = getArguments();

	Promise.all([ui.updateCustomize(), ui.setModalOpList()])
		.then(() => {
			/*
				window.addEventListener("keypress", function (event) {
					switch (event.charCode) {
						case 32: // Spacebar
							event.preventDefault(); // Prevent space from scrolling page on some browsers
							break;
					};
				});
			*/
			if (args.get('file')) {
				document.addEventListener("mapInited", function (event) {
					let args = getArguments();
					if (args.get('x') && args.get('y') && args.get('zoom')) {
						let coords = [parseFloat(args.get('x')), parseFloat(args.get('y'))];
						let zoom = parseFloat(args.get('zoom'));
						map.setView(coords, zoom);
					}
					if (args.get('frame')) {
						ui.setMissionCurTime(parseInt(args.get('frame')));
					}
				}, false);
				return processOp("data/" + args.get('file'), null);
			};


			document.addEventListener("operationProcessed", function (event) {
				let bounds = getMapMarkerBounds();
				map.fitBounds(bounds);
			});
		})
		.catch((error) => {
			ui.showHint(error);
		});

	if (args.get('experimental')) ui.showExperimental();
}

async function getWorldByName (worldName) {
	console.log("Getting world " + worldName);

	let defaultMap = {
		"name": "NOT FOUND",
		"displayName": "NOT FOUND",
		"worldname": "NOT FOUND",
		"worldSize": 16384,
		"imageSize": 16384,
		"multiplier": 1,
		"maxZoom": 6,
		"minZoom": 0,
		"hasTopo": true,
		"hasTopoRelief": false,
		"hasTopoDark": false,
		"hasColorRelief": false,
		"attribution": "Bohemia Interactive and 3rd Party Developers"
	};

	// Check for, and return local map data if available
	const localMapRes = await fetch(
		'images/maps/' + worldName + '/map.json',
		{ cache: "no-store" }
	);
	if (localMapRes.status === 200) {
		try {
			return Object.assign(defaultMap, await localMapRes.json());
		} catch (error) {
			//ui.showHint(`Error: parsing local map.json`);
			console.error('Error parsing local map.json', error.message || error);
		}
	}

	// Fallback to cloud CDN if enabled
	if (ui.useCloudTiles) {
		let cloudMapRes;
		try {
			cloudMapRes = await fetch(
				`https://maps.ocap2.com/${worldName}/map.json`,
				{ cache: "no-store" }
			);
		} catch (error) {
			// clone default map if not found
			Object.assign(defaultMap, {
				"imageSize": 30720,
				"worldSize": 30720,
				"multiplier": 1,
				"worldName": worldName
			});
			console.warn("World not found, using blank map")
			alert(`The map for this mission (worldName: ${worldName}) is not available locally or in the cloud.\n\nA placeholder will be shown instead. Please report this issue on the OCAP2 Discord.\n\nhttps://discord.gg/wQusAQnrBP`);
			worldName = "";

			return Promise.resolve(defaultMap);
		};
		if (cloudMapRes.status === 200) {
			try {
				return Object.assign(defaultMap, await cloudMapRes.json(), { _useCloudTiles: true });
			} catch (error) {
				console.error('Error parsing cloud map.json', error.message || error);
				return Promise.reject(`Cloud map "${worldName}" data parsing failed.`);
			}
		} else {
			// clone default map if not found
			Object.assign(defaultMap, {
				"imageSize": 30720,
				"worldSize": 30720,
				"multiplier": 1,
				"worldName": worldName
			});
			worldName = "";
			console.warn("World not found, using blank map")
			alert(`The map for this mission (worldName: ${worldName}) is not available locally or in the cloud.\n\nA placeholder will be shown instead. Please report this issue on the OCAP2 Discord.\n\nhttps://discord.gg/wQusAQnrBP`);

			return Promise.resolve(defaultMap);
			// return Promise.reject(`Map "${worldName}" is not available on cloud (${cloudMapRes.status})`);
		}
	} else {
		return Promise.reject(`Map "${worldName}" is not installed`);
	}
}

function initMap (world) {
	// Bad
	mapMaxNativeZoom = world.maxZoom
	mapMaxZoom = mapMaxNativeZoom + 2

	imageSize = world.imageSize;
	multiplier = world.multiplier;

	var factorx = multiplier;
	var factory = multiplier;
	// var factorx = 1;
	// var factory = 1;

	L.CRS.OCAP = L.extend({}, L.CRS.Simple, {
		projection: L.Projection.LonLat,
		transformation: new L.Transformation(factorx, 0, -factory, 0),
		// Changing the transformation is the key part, everything else is the same.
		// By specifying a factor, you specify what distance in meters one pixel occupies (as it still is CRS.Simple in all other regards).
		// In this case, I have a tile layer with 256px pieces, so Leaflet thinks it's only 256 meters wide.
		// I know the map is supposed to be 2048x2048 meters, so I specify a factor of 0.125 to multiply in both directions.
		// In the actual project, I compute all that from the gdal2tiles tilemapresources.xml, 
		// which gives the necessary information about tilesizes, total bounds and units-per-pixel at different levels.


		// Scale, zoom and distance are entirely unchanged from CRS.Simple
		scale: function (zoom) {
			return Math.pow(2, zoom);
		},

		zoom: function (scale) {
			return Math.log(scale) / Math.LN2;
		},

		distance: function (latlng1, latlng2) {
			var dx = latlng2.lng - latlng1.lng,
				dy = latlng2.lat - latlng1.lat;

			return Math.sqrt(dx * dx + dy * dy);
		},
		infinite: true
	});

	// Create map
	map = L.map('map', {
		center: [0, 0],
		zoom: 0,
		maxNativeZoom: mapMaxNativeZoom,
		maxZoom: mapMaxZoom,
		minNativeZoom: 0,
		minZoom: 0,
		// zoominfoControl: true, // moved for custom position
		zoomControl: false,
		scrollWheelZoom: true,
		zoomAnimation: true,
		fadeAnimation: true,
		crs: L.CRS.OCAP,
		attributionControl: true,
		zoomSnap: 1,
		zoomDelta: 1,
		closePopupOnClick: false,
		preferCanvas: true
	});


	// Hide marker popups once below a certain zoom level
	map.on("zoom", function () {
		ui.hideMarkerPopups = map.getZoom() <= 4;
		// if (map.getZoom() <= 5 && geoJsonHouses != null) {
		// 	geoJsonHouses.setStyle(function (geoJsonFeature) {
		// 		return {
		// 			color: "#4D4D4D",
		// 			interactive: false,
		// 			fill: true,
		// 			opacity: 0,
		// 			fillOpacity: 0,
		// 			noClip: true,
		// 			// renderer: L.canvas()
		// 			// weight: geoJsonFeature.properties.width * window.multiplier,
		// 		};
		// 	});
		// } else if (geoJsonHouses != null) {
		// 	geoJsonHouses.setStyle(function (geoJsonFeature) {
		// 		return {
		// 			color: "#4D4D4D",
		// 			interactive: false,
		// 			fill: true,
		// 			opacity: 1,
		// 			fillOpacity: 1,
		// 			noClip: true,
		// 			// renderer: L.canvas()
		// 			// weight: geoJsonFeature.properties.width * window.multiplier,
		// 		};
		// 	});
		// }
	});

	let playbackPausedBeforeZoom;
	map.on("zoomstart", () => {
		cancelAnimationFrame(requestedFrame);
		document.getElementById("container").classList.add("zooming");
		playbackPausedBeforeZoom = playbackPaused;
		if (!playbackPaused) {
			playbackPaused = true;
		}
	});
	map.on("zoomend", () => {
		document.getElementById("container").classList.remove("zooming");
		playbackPaused = playbackPausedBeforeZoom;
	});
	map.on("popupopen", (e) => {
		e.popup.getElement().classList.add("animation");
	});
	map.on("popupclose", (e) => {
		e.popup.getElement().classList.remove("animation");
	});
	map.on("dragstart", function () {
		if (entityToFollow != null) {
			entityToFollow.unfollow();
		}
	});


	// Setup tile layers
	var baseLayers = [];

	entitiesLayerGroup.addTo(map);
	markersLayerGroup.addTo(map);
	systemMarkersLayerGroup.addTo(map);
	projectileMarkersLayerGroup.addTo(map);


	// worldName = world.worldName;


	let topoLayerUrl = "";
	let topoDarkLayerUrl = "";
	let topoReliefLayerUrl = "";
	let colorReliefLayerUrl = "";


	if (worldName === "") {
		console.log("World name missing or not rendered. Using default map.")
		// if default map is used as placeholder, use custom topo layer url
		topoLayerUrl = 'http://maps.ocap2.com/missing_tiles.png';
	} else if (Boolean(world._useCloudTiles)) {
		console.log("Streaming map tiles from the cloud (maps.ocap2.com).")
		topoLayerUrl = ('https://maps.ocap2.com/' + worldName.toLowerCase() + '/{z}/{x}/{y}.png');
		topoDarkLayerUrl = ('https://maps.ocap2.com/' + worldName.toLowerCase() + '/topoDark/{z}/{x}/{y}.png');
		topoReliefLayerUrl = ('https://maps.ocap2.com/' + worldName.toLowerCase() + '/topoRelief/{z}/{x}/{y}.png');
		colorReliefLayerUrl = ('https://maps.ocap2.com/' + worldName.toLowerCase() + '/colorRelief/{z}/{x}/{y}.png');
	} else {
		console.log("Streaming map tiles from the local OCAP2 installation.")
		topoLayerUrl = ('images/maps/' + worldName + '/{z}/{x}/{y}.png');
		topoDarkLayerUrl = ('images/maps/' + worldName + '/topoDark/{z}/{x}/{y}.png');
		topoReliefLayerUrl = ('images/maps/' + worldName + '/topoRelief/{z}/{x}/{y}.png');
		colorReliefLayerUrl = ('images/maps/' + worldName + '/colorRelief/{z}/{x}/{y}.png');
	}

	console.log("Getting bounds for layers...")
	mapBounds = getMapImageBounds()

	if (world.hasTopo) {
		topoLayer = L.tileLayer(topoLayerUrl, {
			maxNativeZoom: world.maxZoom,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Topographic",
			attribution: "Map Data &copy; " + world.attribution,
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.7,
			errorTileUrl: 'http://maps.ocap2.com/missing_tiles.png'
		});
		baseLayers.push(topoLayer);
	}

	if (world.hasTopoDark) {
		topoDarkLayer = L.tileLayer(topoDarkLayerUrl, {
			maxNativeZoom: world.maxZoom,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Topographic Dark",
			attribution: "Map Data &copy; " + world.attribution,
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.8,
			errorTileUrl: 'http://maps.ocap2.com/missing_tiles.png'
		});
		baseLayers.push(topoDarkLayer);
	}

	if (world.hasTopoRelief) {
		topoReliefLayer = L.tileLayer(topoReliefLayerUrl, {
			maxNativeZoom: world.maxZoom,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Topographic Relief",
			attribution: "Map Data &copy; " + world.attribution,
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.9,
			errorTileUrl: 'http://maps.ocap2.com/missing_tiles.png'
		});
		baseLayers.push(topoReliefLayer);
	}

	if (world.hasColorRelief) {
		colorReliefLayer = L.tileLayer(colorReliefLayerUrl, {
			maxNativeZoom: world.maxZoom,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			attribution: "Map Data &copy; " + world.attribution,
			label: "Colored Relief",
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 1,
			errorTileUrl: 'http://maps.ocap2.com/missing_tiles.png'
		});
		baseLayers.push(colorReliefLayer);
	}


	// setup controls

	overlayLayerControl = L.control.layers({}, {
		// overlay layers
		"Units and Vehicles": entitiesLayerGroup,
		"Selected Side Markers": markersLayerGroup,
		"Editor/Briefing Markers": systemMarkersLayerGroup,
		"Projectile Markers": projectileMarkersLayerGroup
	}, {
		position: 'bottomright',
		collapsed: false
	});
	overlayLayerControl.addTo(map);


	baseLayerControl = L.control.basemaps({
		basemaps: baseLayers,
		tileX: 2,  // tile X coordinate
		tileY: 6,  // tile Y coordinate
		tileZ: 4   // tile zoom level
	}, {
		position: 'bottomright',
	});
	baseLayerControl.addTo(map);


	// Add zoom control
	L.control.zoominfo({
		position: 'bottomright'
	}).addTo(map);


	function test () {
		// Add marker to map on click
		map.on("click", function (e) {
			// latLng, layerPoint, containerPoint, originalEvent
			console.debug("latLng");
			console.debug(e.latlng);
			console.debug("LayerPoint");
			console.debug(e.layerPoint);
			console.debug("Projected");
			console.debug(map.project(e.latlng, mapMaxNativeZoom));
		})
	}


	map.on("baselayerchange", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		// multiplier = event.name
	});
	map.on("overlayadd", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		switch (event.name) {
			case "Units and Vehicles": {
				if (ui.hideMarkerPopups == false) {
					entitiesLayerGroup.eachLayer(layer => {
						layer.openPopup();
					});
				}
				break;
			};
			case "Selected Side Markers": {
				markersLayerGroup.eachLayer(layer => {
					layer.remove()
				})
				markers.forEach(marker => {
					if (marker._player instanceof Unit) {
						marker._marker = null;
					}
				})
				// for (const marker of markers) {
				// 	marker.manageFrame(playbackFrame);
				// }
				break;
			};
			case "Editor/Briefing Markers": {
				if (ui.markersEnable == true) {
					systemMarkersLayerGroup.eachLayer(layer => {
						layer.openPopup();
					})
				}
				break;
			};
			case "Projectile Markers": {
				projectileMarkersLayerGroup.getLayers().forEach(layer => {
					layer.remove()
				})
				markers.forEach(marker => {
					if (marker.isMagIcon()) {
						marker._marker = null;
					}
				})
				break;
			};

			default: {
				break;
			};
		};
	});
	map.on("overlayremove", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		switch (event.name) {
			case "Units and Vehicles": {
				// ui.hideMarkerPopups = false;
				// entitiesLayerGroup.eachLayer(layer => {
				// 	layer.openPopup();
				// });
				break;
			};
			case "Selected Side Markers": {
				markersLayerGroup.eachLayer(layer => {
					// layer.remove()
				})
				break;
			};
			case "Editor/Briefing Markers": {
				// systemMarkersLayerGroup.eachLayer(layer => {
				// 	layer.openPopup();
				// })
				break;
			};
			case "Projectile Markers": {
				projectileMarkersLayerGroup.getLayers().forEach(layer => {
					layer.remove()
				})

				break;
			};

			default: {
				break;
			};
		};
	});



	// Add keypress event listener
	mapDiv.addEventListener("keypress", function (event) {
		//console.log(event);

		switch (event.charCode) {
			case 32: // Spacebar
				playPause();
				break;
		}
	});



	createInitialMarkers();

	document.dispatchEvent(new Event("mapInited"));
	// test();
}

function createInitialMarkers () {
	entities.getAll().forEach(function (entity) {
		// Create and set marker for unit
		const pos = entity.getPosAtFrame(0);
		if (pos) { // If unit did exist at start of game
			entity.createMarker(armaToLatLng(pos.position));
		}
	});
}

function getMapImageBounds () {
	console.debug("Calculating map bounds from map image size");
	mapBounds = new L.LatLngBounds(
		map.unproject([0, worldObject.imageSize], mapMaxNativeZoom),
		map.unproject([worldObject.imageSize, 0], mapMaxNativeZoom)
	);
	return mapBounds;
}

function getMapMarkerBounds () {

	let boundaryMarks = markers.filter(item => {
		return item._type === "moduleCoverMap"
	});

	if (boundaryMarks.length === 4) {
		console.debug("Found boundary marks from BIS_moduleCoverMap")
		let boundaryPoints = boundaryMarks.map(item => armaToLatLng(item._positions[0][1]));
		let boundaryPolygon = L.polygon(boundaryPoints, { color: "#000000", fill: false, interactive: false, noClip: true }).addTo(map);

		return boundaryPolygon.getBounds();
	}

	// calculate map bounds from markers
	console.debug(`Calculating map bounds from ${markers.length} markers`)
	var markerBounds = L.latLngBounds()
	let invalidMarkers = [];
	markers.forEach(item => {
		if (item._positions[0] === undefined) {
			return invalidMarkers.push(item)
		}
		if (item._positions[0][1] === undefined) {
			return invalidMarkers.push(item)
		}

		// some marker positions are nested in an array, account for this
		if (Array.isArray(item._positions[0][1][0])) {
			return markerBounds.extend(armaToLatLng(item._positions[0][1][0]));
		} else {
			return markerBounds.extend(armaToLatLng(item._positions[0][1]));
		};
	});

	if (invalidMarkers.length > 0) {
		console.debug(`Found ${invalidMarkers.length} potentially invalid markers, ignoring them`, invalidMarkers)
	}


	return markerBounds;
}

function defineIcons () {
	icons = {
		man: {},
		ship: {},
		parachute: {},
		heli: {},
		plane: {},
		truck: {},
		car: {},
		apc: {},
		tank: {},
		staticMortar: {},
		staticWeapon: {},
		unknown: {}
	};

	let imgPathMan = "images/markers/man/";
	// let imgPathManMG = "images/markers/man/MG/";
	// let imgPathManGL = "images/markers/man/GL/";
	// let imgPathManAT = "images/markers/man/AT/";
	// let imgPathManSniper = "images/markers/man/Sniper/";
	// let imgPathManAA = "images/markers/man/AA/";
	let imgPathShip = "images/markers/ship/";
	let imgPathParachute = "images/markers/parachute/";
	let imgPathHeli = "images/markers/heli/";
	let imgPathPlane = "images/markers/plane/";
	let imgPathTruck = "images/markers/truck/";
	let imgPathCar = "images/markers/car/";
	let imgPathApc = "images/markers/apc/";
	let imgPathTank = "images/markers/tank/";
	let imgPathStaticMortar = "images/markers/static-mortar/";
	let imgPathStaticWeapon = "images/markers/static-weapon/";
	let imgPathUnknown = "images/markers/unknown/";


	let imgs = ["blufor", "opfor", "ind", "civ", "logic", "unknown", "dead", "hit", "follow", "unconscious"];
	imgs.forEach((img, i) => {
		icons.man[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathMan}${img}.svg` });
		// icons.manMG[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManMG}${img}.svg` });
		// icons.manGL[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManGL}${img}.svg` });
		// icons.manAT[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManAT}${img}.svg` });
		// icons.manSniper[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManSniper}${img}.svg` });
		// icons.manAA[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManAA}${img}.svg` });
		icons.ship[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathShip}${img}.svg` });
		icons.parachute[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathParachute}${img}.svg` });
		icons.heli[img] = L.icon({ className: "animation", iconSize: [32, 32], iconUrl: `${imgPathHeli}${img}.svg` });
		icons.plane[img] = L.icon({ className: "animation", iconSize: [32, 32], iconUrl: `${imgPathPlane}${img}.svg` });
		icons.truck[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathTruck}${img}.svg` });
		icons.car[img] = L.icon({ className: "animation", iconSize: [24, 24], iconUrl: `${imgPathCar}${img}.svg` });
		icons.apc[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathApc}${img}.svg` });
		icons.tank[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathTank}${img}.svg` });
		icons.staticMortar[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathStaticMortar}${img}.svg` });
		icons.staticWeapon[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathStaticWeapon}${img}.svg` });
		icons.unknown[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathUnknown}${img}.svg` });
	});
}

function goFullscreen () {
	if (document.webkitIsFullScreen) {
		document.webkitExitFullscreen();
		return;
	}
	var element = document.getElementById("container");
	if (element.requestFullscreen) {
		element.requestFullscreen();
	} else if (element.mozRequestFullScreen) {
		element.mozRequestFullScreen();
	} else if (element.webkitRequestFullscreen) {
		element.webkitRequestFullscreen();
	} else if (element.msRequestFullscreen) {
		element.msRequestFullscreen();
	}
}
// http://127.0.0.1:5000/?file=2021_08_20__21_24_FNF_TheMountain_Youre_A_Towel_V2_Destroy_EU.json&frame=87&zoom=1&x=-134.6690319189602&y=78.0822715759277
// Converts Arma coordinates [x,y] to LatLng
function armaToLatLng (coords) {
	var pixelCoords;
	pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return map.unproject(pixelCoords, mapMaxNativeZoom);
}

// Returns date object as little endian (day, month, year) string
function dateToLittleEndianString (date) {
	return (date.getDate() + "/" + (date.getMonth() + 1) + "/" + date.getFullYear());
}

function dateToTimeString (date, isUtc = false) {
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let seconds = date.getSeconds();
	if (isUtc) {
		hours = date.getUTCHours();
		minutes = date.getUTCMinutes();
		seconds = date.getUTCSeconds();
	}
	let string = "";

	/*	if (hours < 10) {
			string += "0";
		}*/
	string += (hours + ":");

	if (minutes < 10) {
		string += "0";
	}
	string += (minutes + ":");

	if (seconds < 10) {
		string += "0";
	}
	string += seconds;

	return string;
}

// Convert time in seconds to a more readable time format
// e.g. 121 seconds -> 2 minutes
// e.g. 4860 seconds -> 1 hour, 21 minutes
function secondsToTimeString (seconds) {
	let mins = Math.round(seconds / 60);

	if (mins < 60) {
		let minUnit = (mins > 1 ? "mins" : "min");

		return `${mins} ${minUnit}`;
	} else {
		let hours = Math.floor(mins / 60);
		let remainingMins = mins % 60;
		let hourUnit = (hours > 1 ? "hrs" : "hr");
		let minUnit = (remainingMins > 1 ? "mins" : "min");

		return `${hours} ${hourUnit}, ${remainingMins} ${minUnit}`;
	}
}

// Read operation JSON data and create unit objects
function processOp (filepath, opRecord) {
	console.log("Processing operation: (" + filepath + ")...");
	const time = new Date();
	fileName = filepath.substr(5, filepath.length);

	let data;
	return fetch(filepath)
		.then((res) => res.json())
		.then((json) => {
			data = json;
			worldName = data.worldName.toLowerCase();
			return worldName;
		})
		.then((wn) => getWorldByName(wn))
		.then((world) => {
			worldObject = world;
			document.dispatchEvent(new Event("worldLoaded"))
			multiplier = world.multiplier;
			missionName = data.missionName;

			let playedDate;
			if (opRecord) {
				playedDate = opRecord.date;
			} else {
				// try to parse from filename
				// if filename has "\d__\d" format, use that
				// else no date, in the event a temp file is referenced
				let dateMatch = fileName.match(/^\d{4}_\d{2}_\d{2}/);
				if (dateMatch) {
					playedDate = dateMatch[0].replace(/_/g, "-");
				} else {
					playedDate = "<UnknownDate>";
				}
			}

			let worldDisplayName;
			if ([undefined, "NOT FOUND"].includes(world.displayName)) {
				if (world.name == "NOT FOUND") {
					worldDisplayName = world.worldName
				} else {
					worldDisplayName = world.name
				}
			} else {
				worldDisplayName = world.displayName
			}
			ui.setMissionName(`${missionName} - Recorded ${playedDate} on ${worldDisplayName}`);

			extensionVersion = data.extensionVersion;
			ui.setExtensionVersion(extensionVersion);
			addonVersion = data.addonVersion;
			ui.setAddonVersion(addonVersion);
			endFrame = data.endFrame;
			frameCaptureDelay = data.captureDelay * 1000;
			ui.setMissionEndTime(endFrame);
			if (data.times) {
				ui.detectTimes(data.times);
			}
			ui.checkAvailableTimes();

			var showCiv = false;
			var showWest = false;
			var showEast = false;
			var showGuer = false;
			var arrSide = ["GLOBAL", "EAST", "WEST", "GUER", "CIV"];

			// Loop through entities
			data.entities.forEach(function (entityJSON) {
				//console.log(entityJSON);

				let type = entityJSON.type;
				let startFrameNum = entityJSON.startFrameNum;
				let id = entityJSON.id;
				let name = entityJSON.name;
				let arrSideSelect = [];
				// Convert positions into array of objects
				let positions = [];
				entityJSON.positions.forEach(function (entry, i) {
					if (entry == []) {
						positions.push(positions[i - 1]);
					} else {
						let pos = entry[0];
						let dir = entry[1];
						let alive = entry[2];

						if (type == "unit") {
							let name = entry[4];
							if (name == "" && i != 0)
								name = positions[i - 1].name;
							if (name == "" && i == 0)
								name = "unknown";
							positions.push({ position: pos, direction: dir, alive: alive, isInVehicle: (entry[3] == 1), name: name, isPlayer: entry[5] });
						} else {
							let crew = entry[3];
							const vehicle = { position: pos, direction: dir, alive: alive, crew: crew };
							if (entry.length >= 5) {
								vehicle.frames = entry[4];
							}
							positions.push(vehicle);
						}
					}
				});

				if (type === "unit") {
					//if (entityJSON.name == "Error: No unit") {return}; // Temporary fix for old captures that initialised dead units

					// Add group to global groups object (if new)
					let group = groups.findGroup(entityJSON.group, entityJSON.side);
					if (group == null) {
						group = new Group(entityJSON.group, entityJSON.side);
						groups.addGroup(group);
					}

					// Create unit and add to entities list
					const unit = new Unit(startFrameNum, id, name, group, entityJSON.side, (entityJSON.isPlayer === 1), positions, entityJSON.framesFired, entityJSON.role);
					entities.add(unit);

					// Show title side
					if (arrSideSelect.indexOf(entityJSON.side) === -1) {
						arrSideSelect.push(entityJSON.side);
						switch (entityJSON.side) {
							case "WEST":
								showWest = true;
								break;
							case "EAST":
								showEast = true;
								break;
							case "GUER":
								showGuer = true;
								break;
							case "CIV":
								showCiv = true;
								break;
						}
					}
				} else {
					// Create vehicle and add to entities list
					const vehicle = new Vehicle(startFrameNum, id, entityJSON.class, name, positions);
					entities.add(vehicle);
				}
			});

			if (data.Markers != null) {
				data.Markers.forEach(function (markerJSON) {
					try {
						var type = markerJSON[0];
						var text = markerJSON[1];
						var startFrame = markerJSON[2];
						var endFrame = markerJSON[3];
						var player;
						if (markerJSON[4] == -1) {
							player = -1;
						} else {
							player = entities.getById(markerJSON[4]);
						}
						var color = markerJSON[5];
						var side = arrSide[markerJSON[6] + 1];
						var positions = markerJSON[7];

						// backwards compatibility for marker expansion
						let size = "";
						let shape = "ICON";
						let brush = "Solid";
						if (markerJSON.length > 8) {
							if (markerJSON[9] == "ICON") {
								size = markerJSON[8]
							} else {
								size = markerJSON[8];//.map(value => value * multiplier);
							}
							shape = markerJSON[9];
						}
						if (markerJSON.length > 10) {
							brush = markerJSON[10];
						}

						if (!(type.includes("zoneTrigger") || type.includes("Empty"))) {
							var marker = new Marker(type, text, player, color, startFrame, endFrame, side, positions, size, shape, brush);
							markers.push(marker);
						}
					} catch (err) {
						console.error(`Failed to process ${markerJSON[9]} with type ${markerJSON[0]} and text "${markerJSON[1]}"\nError: ${err}\nMarkerJSON: ${JSON.stringify(markerJSON, null, 2)}`)
					}
				});
			}
			// Show title side
			var countShowSide = 0;
			if (showCiv) countShowSide++;
			if (showEast) countShowSide++;
			if (showGuer) countShowSide++;
			if (showWest) countShowSide++;
			function showTitleSide (elem, isShow) {
				elem = document.getElementById(elem);
				if (isShow) {
					elem.style.width = "calc(" + 100 / countShowSide + "% - 2.5px)";
					elem.style.display = "inline-block";
				} else {
					elem.style.display = "none";
				}
			}

			showTitleSide("sideEast", showEast);
			showTitleSide("sideWest", showWest);
			showTitleSide("sideGuer", showGuer);
			showTitleSide("sideCiv", showCiv);

			if (showWest) {
				ui.switchSide("WEST");
			} else if (showEast) {
				ui.switchSide("EAST");
			} else if (showGuer) {
				ui.switchSide("IND");
			} else if (showCiv) {
				ui.switchSide("CIV");
			}

			// Loop through events
			var invalidHitKilledEvents = [];
			data.events.forEach(function (eventJSON) {
				var frameNum = eventJSON[0];
				var type = eventJSON[1];

				var gameEvent = null;

				switch (true) {
					case (type == "killed" || type == "hit"):
						const causedByInfo = eventJSON[3];
						const victim = entities.getById(eventJSON[2]);
						const causedBy = entities.getById(causedByInfo[0]); // In older captures, this will return null
						const distance = eventJSON[4];

						//console.log(eventJSON[2]);
						//if (victim == null) {return}; // Temp fix until vehicles are handled (victim is null if reference is a vehicle)

						// Create event object
						let weapon;
						if (causedBy instanceof Unit) {
							weapon = causedByInfo[1];
						} else {
							weapon = "N/A";
						}

						// TODO: Find out why victim/causedBy can sometimes be null
						if (causedBy == null || victim == null) {
							invalidHitKilledEvents.push({
								"reason": "null/unknown victim/causedBy",
								"victim": victim,
								"causedBy": causedBy,
								"event": eventJSON
							});
						}

						// Incrememt kill/death count for killer/victim
						if (type === "killed" && (causedBy != null)) {
							if (causedBy !== victim) {
								if (causedBy._side === victim._side) {
									causedBy.teamKillCount++;
								} else {
									causedBy.killCount++;
								}
							}
							victim.deathCount++;
						}
						gameEvent = new HitKilledEvent(frameNum, type, causedBy, victim, distance, weapon);

						// Add tick to timeline
						ui.addTickToTimeline(frameNum);
						break;
					case (type == "connected" || type == "disconnected"):
						gameEvent = new ConnectEvent(frameNum, type, eventJSON[2]);
						break;
					case (type === "capturedFlag"): // deprecated
						gameEvent = new CapturedEvent(frameNum, type, "flag", eventJSON[2][0], eventJSON[2][1], eventJSON[2][2], eventJSON[2][3]);
						break;
					case (type === "captured"):
						gameEvent = new CapturedEvent(
							frameNum,
							type,
							eventJSON[2][0], // capture type
							eventJSON[2][1], // unit name
							eventJSON[2][2], // unit color
							eventJSON[2][3], // objective color
							eventJSON[2][4], // objective position
						);
						break;
					case (type === "terminalHackStarted"):
						gameEvent = new TerminalHackStartEvent(
							frameNum,
							type,
							eventJSON[2][0], // unit name
							eventJSON[2][1], // unit color
							eventJSON[2][2], // terminal color
							eventJSON[2][3], // terminal identifier
							eventJSON[2][4], // terminal position
							eventJSON[2][5], // countdown timer
						);
						break;
					case (type === "terminalHackCanceled"):
						gameEvent = new TerminalHackUpdateEvent(
							frameNum,
							type,
							eventJSON[2][0], // unit name
							eventJSON[2][1], // unit color
							eventJSON[2][2], // terminal color
							eventJSON[2][3], // terminal identifier
							eventJSON[2][4], // terminal state
						);
						break;
					case (type == "endMission"):
						gameEvent = new endMissionEvent(frameNum, type, eventJSON[2][0], eventJSON[2][1]);
						break;
					case (type == "generalEvent"):
						gameEvent = new generalEvent(frameNum, type, eventJSON[2]);
						break;
				}

				// Add event to gameEvents list
				if (gameEvent != null) {
					gameEvents.addEvent(gameEvent);
				}
			});

			if (invalidHitKilledEvents.length > 0) {
				console.warn("WARNING: " + invalidHitKilledEvents.length + " hit/killed events will use 'something' as the victim/killer. See the debug stream for a full list.");
				console.debug(invalidHitKilledEvents);
			}

			gameEvents.init();

			console.log("Finished processing operation (" + (new Date() - time) + "ms).");
			console.debug("Addon version: " + data.addonVersion);
			console.debug("Extension version: " + data.extensionVersion);
			console.debug("Extension build: " + data.extensionBuild);
			console.debug("Total frames: " + data.endFrame);
			console.debug("Total entities: " + data.entities.length);
			console.debug("Total markers: " + data.Markers.length);
			console.debug("Total events: " + data.events.length);
			if (data.Markers.length > 50000) {
				console.warn("WARNING: This mission contains more than 50,000 markers. This may cause performance issues and indicate configured or malformed marker exclusion settings in the addon.");
			}
			console.log("Initializing map...");
			console.debug(JSON.stringify(world, null, 2));
			initMap(world);
			startPlaybackLoop();
			toggleHitEvents(false);
			// playPause();
			ui.hideModal();

			// fire event
			document.dispatchEvent(new Event('operationLoaded'));
		}).catch((error) => {
			ui.modalBody.innerHTML = `Error: "${filepath}" failed to load.<br/>${error}.`;
			console.error(error);
		});
}

function playPause () {
	playbackPaused = !playbackPaused;

	if (playbackPaused) {
		playPauseButton.style.backgroundPosition = "0 0";
	} else {
		playPauseButton.style.backgroundPosition = `-${playPauseButton.offsetWidth}px 0`;
	}
}

function toggleHitEvents (showHint = true) {
	ui.showHitEvents = !ui.showHitEvents;

	let text;
	if (ui.showHitEvents) {
		ui.filterHitEventsButton.style.opacity = 1;
		text = getLocalizable("shown");
	} else {
		ui.filterHitEventsButton.style.opacity = 0.5;
		text = getLocalizable("hidden");
	}

	if (showHint) {
		ui.showHint(getLocalizable("event_fire") + text);
	}
}

function toggleConnectEvents (showHint = true) {
	ui.showConnectEvents = !ui.showConnectEvents;

	let text;
	if (ui.showConnectEvents) {
		ui.filterConnectEventsButton.style.opacity = 1;
		text = getLocalizable("shown");
	} else {
		ui.filterConnectEventsButton.style.opacity = 0.5;
		text = getLocalizable("hidden");
	}

	if (showHint) {
		ui.showHint(getLocalizable("event_dis-connected") + text);
	}
}

let lastDrawnFrame = -1;
function startPlaybackLoop () {
	var killlines = [];
	var firelines = [];

	function playbackFunction () {
		if (!playbackPaused || lastDrawnFrame !== playbackFrame) {
			requestedFrame = requestAnimationFrame(() => {
				// Remove killines & firelines from last frame
				killlines.forEach(function (line) {
					map.removeLayer(line);
				});
				firelines.forEach(function (line) {
					map.removeLayer(line);
				});

				countCiv = 0;
				countEast = 0;
				countGuer = 0;
				countWest = 0;

				for (const entity of entities.getAll()) {
					entity.updateRender(playbackFrame);
					entity.manageFrame(playbackFrame);

					if (entity instanceof Unit) {
						// Draw fire line (if enabled)
						var projectilePos = entity.firedOnFrame(playbackFrame);
						if (projectilePos != null && ui.firelinesEnabled) {
							const entityPos = entity.getLatLng();
							if (entityPos) {
								// console.log(`Shooter pos: ${entity.getLatLng()}\nFired event: ${projectilePos} (is null: ${projectilePos == null})`);
								const line = L.polyline([entity.getLatLng(), armaToLatLng(projectilePos)], {
									color: entity.getSideColour(),
									weight: 2,
									opacity: 0.4
								});
								line.addTo(map);
								firelines.push(line);
							} else {
								console.warn("entity position missing for fire line", entity, projectilePos);
							}
						}
					}
				}

				ui.updateTitleSide();

				// Display events for this frame (if any)
				for (const event of gameEvents.getEvents()) {

					// Check if event is supposed to exist by this point
					if (event.frameNum <= playbackFrame) {
						ui.addEvent(event);

						// Draw kill line
						if (event.frameNum == playbackFrame) {
							if (event.type == "killed") {
								var victim = event.victim;
								var killer = event.causedBy;

								// Draw kill line
								if (killer.id) {
									//console.log(victim);
									//console.log(killer);
									var victimPos = victim.getLatLng();
									var killerPos = killer.getLatLng();

									if (victimPos != null && killerPos != null) {
										var line = L.polyline([victimPos, killerPos], {
											color: killer.getSideColour(),
											weight: 2,
											opacity: 0.4
										});
										line.addTo(map);
										killlines.push(line);
									}
								}
							}

							// Flash unit's icon
							if (event.type == "hit") {
								var victim = event.victim;
								victim.flashHit();
							}
						}

					} else {
						ui.removeEvent(event);
					}
				}
				for (const marker of markers) {
					marker.manageFrame(playbackFrame);
					if (!marker.isMagIcon()) {
						if (ui.markersEnable) {
							marker.hideMarkerPopup(false);
						} else {
							marker.hideMarkerPopup(true);
						}
					}
					if (marker.isMagIcon()) {
						if (ui.nicknameEnable) {
							marker.hideMarkerPopup(false);
						} else {
							marker.hideMarkerPopup(true);
						}
					}
				}

				// Handle entityToFollow
				if (entityToFollow != null) {
					const relativeFrameIndex = entityToFollow.getRelativeFrameIndex(playbackFrame);
					const pos = entityToFollow.getPosAtFrame(relativeFrameIndex);
					if (pos) {
						map.setView(armaToLatLng(pos.position), map.getZoom());
					} else { // Unit has died or does not exist, unfollow
						entityToFollow.unfollow();
					}
				}
				if (!playbackPaused && playbackFrame !== endFrame) {
					playbackFrame++;
				}
				if (playbackFrame === endFrame) {
					playbackPaused = true;
					playPauseButton.style.backgroundPosition = "0 0";
				}
				ui.setMissionCurTime(playbackFrame);

				lastDrawnFrame = playbackFrame;
			});
		} else {
			requestAnimationFrame(() => {
				for (const entity of entities.getAll()) {
					entity.updateRender(playbackFrame);
				}
				for (const marker of markers) {
					marker.updateRender(playbackFrame);
				}
			});
		}

		// Run timeout again (creating a loop, but with variable intervals)
		playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
	}

	var playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
}

function colorElement (element, color) {
	if (!color) {
		return;
	}

	if (color === "EAST") {
		element.className = "opfor";
	} else if (color === "WEST") {
		element.className = "blufor";
	} else if (color === "IND") {
		element.className = "ind";
	} else if (color === "CIV") {
		element.className = "civ";
	} else if (color && color.startsWith('#')) {
		element.style.color = color;
	}
}

function getMarkerColor (color, defaultColor = "ffffff") {
	let hexColor = defaultColor;
	if (!color) {
		return hexColor;
	}

	if (color === "EAST") {
		hexColor = "ff0000";
	} else if (color === "WEST") {
		hexColor = "00a8ff";
	} else if (color === "IND") {
		hexColor = "00cc00";
	} else if (color === "CIV") {
		hexColor = "C900FF";
	} else if (color && color.startsWith('#')) {
		hexColor = color.substring(1);
	} else {
		console.warn("unknown color", color);
	}

	return hexColor;
}
function colorMarkerIcon (element, icon, color) {
	element.src = `/images/markers/${icon}/${getMarkerColor(color)}.png`;
}


function getPulseMarkerColor (color, defaultColor = "000000") {
	let hexColor = defaultColor;
	if (!color) {
		return hexColor;
	}

	if (color === "EAST") {
		hexColor = "ff0000";
	} else if (color === "WEST") {
		hexColor = "004c99";
	} else if (color === "IND") {
		hexColor = "00cc00";
	} else if (color === "CIV") {
		hexColor = "C900FF";
	} else if (color && color.startsWith('#')) {
		hexColor = color.substring(1);
	} else {
		console.warn("unknown color", color);
	}

	return hexColor;
}

String.prototype.encodeHTMLEntities = function () {
	return this.replace(/[\u00A0-\u9999<>\&]/gim, (i) => {
		return '&#' + i.charCodeAt(0) + ';';
	});
}

function closestEquivalentAngle (from, to) {
	const delta = ((((to - from) % 360) + 540) % 360) - 180;
	return from + delta;
}
