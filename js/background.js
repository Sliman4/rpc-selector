//This is the background script. It is responsible for actually redirecting requests,
//as well as monitoring changes in the redirects and the disabled status and reacting to them.
function log(msg, force) {
	if (log.enabled || force) {
		console.log('REDIRECTOR: ' + msg);
	}
}
log.enabled = false;

const DEFAULT_REDIRECT = new Redirect(
	{
		"description": "Main RPC redirect that makes this extension work on mainnet",
		"exampleUrl": "https://rpc.mainnet.near.org/",
		"exampleResult": "https://near.lava.build/",
		"error": null,
		"includePattern": String.raw`^https://((.*\.)?rpc\.fastnear\.com|(beta\.)?rpc\.mainnet\.(near\.org|pagoda\.co)|rpc\.web4\.near\.page|near-mainnet\.api\.pagoda\.co/rpc/v1|1rpc\.io/near|near-mainnet-rpc\.allthatnode\.com:3030|rpc\.ankr\.com/near|public-rpc\.blockpi\.io/http/near|rpc\.near\.gateway\.fm|getblock\.io/nodes/near|near\.lavenderfive\.com|near\.lava\.build(/.*)?|nodereal\.io/api-marketplace/near-rpc|near\.nownodes\.io|endpoints\.omniatech\.io/v1/near/mainnet/public|api\.seracle\.com/saas/baas/rpc/near/mainnet/public|rpc\.shitzuapes\.xyz)/?$`,
		"excludePattern": "",
		"patternDesc": "All near RPCs",
		"redirectUrl": "https://near.lava.build/",
		"patternType": "R",
		"processMatches": "noProcessing",
		"disabled": false,
		"appliesTo": [
			"xmlhttprequest"
		],
		"isRPC": true
	}
);

function isDarkMode() {
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
var isFirefox = !!navigator.userAgent.match(/Firefox/i);

var storageArea = chrome.storage.local;
//Redirects partitioned by request type, so we have to run through
//the minimum number of redirects for each request.
var partitionedRedirects = {};

//Cache of urls that have just been redirected to. They will not be redirected again, to
//stop recursive redirects, and endless redirect chains.
//Key is url, value is timestamp of redirect.
var ignoreNextRequest = {

};

//url => { timestamp:ms, count:1...n};
var justRedirected = {

};
var redirectThreshold = 10_000;

function setIcon(image) {
	var data = {
		path: {}
	};

	for (let nr of [16,19,32,38,48,64,128]) {
		data.path[nr] = `images/${image}-${nr}.png`;
	}

	chrome.browserAction.setIcon(data, function() {
		var err = chrome.runtime.lastError;
		if (err) {
			//If not checked we will get unchecked errors in the background page console...
			log('Error in SetIcon: ' + err.message);
		}
	});
}

//This is the actual function that gets called for each request and must
//decide whether or not we want to redirect.
function checkRedirects(details) {
	log('Checking: ' + details.type + ': ' + details.url);

	var list = partitionedRedirects[details.type];
	if (!list) {
		log('No list for type: ' + details.type);
		return {};
	}

	var timestamp = ignoreNextRequest[details.url];
	if (timestamp) {
		log('Ignoring ' + details.url + ', was just redirected ' + (new Date().getTime()-timestamp) + 'ms ago');
		delete ignoreNextRequest[details.url];
		return {};
	}


	for (var i = 0; i < list.length; i++) {
		var r = list[i];
		var result = r.getMatch(details.url);

		if (result.isMatch) {

			// The default regexp is likely to match the destination url, so ignore it if that's the case
			if (details.url === result.redirectTo) return {};

			//Check if we're stuck in a loop where we keep redirecting this, in that
			//case ignore!
			var data = justRedirected[details.url];

			var threshold = 3000;
			if(!data || ((new Date().getTime()-data.timestamp) > threshold)) { //Obsolete after 3 seconds
				justRedirected[details.url] = { timestamp : new Date().getTime(), count: 1};
			} else {
				data.count++;
				justRedirected[details.url] = data;
				if (data.count >= redirectThreshold) {
					log('Ignoring ' + details.url + ' because we have redirected it ' + data.count + ' times in the last ' + threshold + 'ms');
					return {};
				}
			}


			log('Redirecting ' + details.url + ' ===> ' + result.redirectTo + ', type: ' + details.type + ', pattern: ' + r.includePattern + ' which is in Rule : ' + r.description);
			ignoreNextRequest[result.redirectTo] = new Date().getTime();

			return { redirectUrl: result.redirectTo };
		}
	}

  	return {};
}

//Monitor changes in data, and setup everything again.
//This could probably be optimized to not do everything on every change
//but why bother?
function monitorChanges(changes, namespace) {
	if (changes.disabled) {
		updateIcon();

		if (changes.disabled.newValue == true) {
			log('Disabling Redirector, removing listener');
			chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
			chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);
		} else {
			log('Enabling Redirector, setting up listener');
			setUpRedirectListener();
		}
	}

	if (changes.redirects) {
		log('Redirects have changed, setting up listener again');
		setUpRedirectListener();
    }

    if (changes.logging) {
		log.enabled = changes.logging.newValue;
		log('Logging settings have changed to ' + changes.logging.newValue, true); //Always want this to be logged...
	}
}
chrome.storage.onChanged.addListener(monitorChanges);

//Creates a filter to pass to the listener so we don't have to run through
//all the redirects for all the request types we don't have any redirects for anyway.
function createFilter(redirects) {
	var types = [];
	for (var i = 0; i < redirects.length; i++) {
		redirects[i].appliesTo.forEach(function(type) {
			// Added this condition below as part of fix for issue 115 https://github.com/einaregilsson/Redirector/issues/115
			// Firefox considers responsive web images request as imageset. Chrome doesn't.
			// Chrome throws an error for imageset type, so let's add to 'types' only for the values that chrome or firefox supports
			if(chrome.webRequest.ResourceType[type.toUpperCase()]!== undefined){
			if (types.indexOf(type) == -1) {
				types.push(type);
			}
		}
		});
	}
	types.sort();

	return {
		urls: ["https://*/*", "http://*/*"],
		types : types
	};
}

function createPartitionedRedirects(redirects) {
	var partitioned = {};

	for (var i = 0; i < redirects.length; i++) {
		var redirect = new Redirect(redirects[i]);
		redirect.compile();
		for (var j=0; j<redirect.appliesTo.length;j++) {
			var requestType = redirect.appliesTo[j];
			if (partitioned[requestType]) {
				partitioned[requestType].push(redirect);
			} else {
				partitioned[requestType] = [redirect];
			}
		}
	}
	return partitioned;
}

//Sets up the listener, partitions the redirects, creates the appropriate filters etc.
function setUpRedirectListener() {

	chrome.webRequest.onBeforeRequest.removeListener(checkRedirects); //Unsubscribe first, in case there are changes...
	chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);

	storageArea.get({redirects:[DEFAULT_REDIRECT]}, function(obj) {
		var redirects = obj.redirects;
		if (redirects.length == 0) {
			log('No redirects defined, not setting up listener');
			return;
		}

		partitionedRedirects = createPartitionedRedirects(redirects);
		var filter = createFilter(redirects);

		log('Setting filter for listener: ' + JSON.stringify(filter));
		chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter, ["blocking"]);

		if (partitionedRedirects.history) {
			log('Adding HistoryState Listener');

			let filter = { url : []};
			for (let r of partitionedRedirects.history) {
				filter.url.push({urlMatches: r._preparePattern(r.includePattern)});
			}
			chrome.webNavigation.onHistoryStateUpdated.addListener(checkHistoryStateRedirects, filter);
		}
	});
}

//Redirect urls on places like Facebook and Twitter who don't do real reloads, only do ajax updates and push a new url to the address bar...
function checkHistoryStateRedirects(ev) {
	ev.type = 'history';
	ev.method = 'GET';
	let result = checkRedirects(ev);
	if (result.redirectUrl) {
		chrome.tabs.update(ev.tabId, {url: result.redirectUrl});
	}
}

//Sets on/off badge, and for Chrome updates dark/light mode icon
function updateIcon() {
	chrome.storage.local.get({disabled:false}, function(obj) {

		//Do this here so even in Chrome we get the icon not too long after an dark/light mode switch...
		if (!isFirefox) {
			if (isDarkMode()) {
				setIcon('icon-dark-theme');
			} else {
				setIcon('icon-light-theme');
			}
		}

		if (obj.disabled) {
			chrome.browserAction.setBadgeText({text: 'off'});
			chrome.browserAction.setBadgeBackgroundColor({color: '#fc5953'});
			if (chrome.browserAction.setBadgeTextColor) { //Not supported in Chrome
				chrome.browserAction.setBadgeTextColor({color: '#fafafa'});
			}
		} else {
			chrome.browserAction.setBadgeText({text: 'on'});
			chrome.browserAction.setBadgeBackgroundColor({color: '#35b44a'});
			if (chrome.browserAction.setBadgeTextColor) { //Not supported in Chrome
				chrome.browserAction.setBadgeTextColor({color: '#fafafa'});
			}
		}
	});
}


//Firefox doesn't allow the "content script" which is actually privileged
//to access the objects it gets from chrome.storage directly, so we
//proxy it through here.
chrome.runtime.onMessage.addListener(
	function(request, sender, sendResponse) {
		log('Received background message: ' + JSON.stringify(request));
		if (request.type == 'get-redirects') {
			log('Getting redirects from storage');
			storageArea.get({
				redirects: [DEFAULT_REDIRECT]
			}, function (obj) {
				log('Got redirects from storage: ' + JSON.stringify(obj));
				sendResponse(obj);
				log('Sent redirects to content page');
			});
		} else if (request.type == 'save-redirects') {
			console.log('Saving redirects, count=' + request.redirects.length);
			delete request.type;
			storageArea.set(request, function (a) {
				if(chrome.runtime.lastError) {
				 if(chrome.runtime.lastError.message.indexOf("QUOTA_BYTES_PER_ITEM quota exceeded")>-1){
					log("Redirects failed to save as size of redirects larger than allowed limit per item by Sync");
					sendResponse({
						message: "Redirects failed to save as size of redirects larger than what's allowed by Sync. Refer Help Page"
					});
				 }
				} else {
				log('Finished saving redirects to storage');
				sendResponse({
					message: "Redirects saved"
				});
			}
			});
		} else if (request.type == 'update-icon') {
			updateIcon();
		} else if (request.type == 'toggle-sync') {
			// Notes on Toggle Sync feature here https://github.com/einaregilsson/Redirector/issues/86#issuecomment-389943854
			// This provides for feature request - issue 86
			delete request.type;
			log('toggling sync to ' + request.isSyncEnabled);
			// Setting for Sync enabled or not, resides in Local.
			chrome.storage.local.set({
					isSyncEnabled: request.isSyncEnabled
				},
				function () {
					if (request.isSyncEnabled) {
						storageArea = chrome.storage.sync;
						log('storageArea size for sync is 5 MB but one object (redirects) is allowed to hold only ' + storageArea.QUOTA_BYTES_PER_ITEM  / 1000000 + ' MB, that is .. ' + storageArea.QUOTA_BYTES_PER_ITEM  + " bytes");
						chrome.storage.local.getBytesInUse("redirects",
							function (size) {
								log("size of redirects is " + size + " bytes");
								if (size > storageArea.QUOTA_BYTES_PER_ITEM) {
									log("size of redirects " + size + " is greater than allowed for Sync which is " + storageArea.QUOTA_BYTES_PER_ITEM);
									// Setting storageArea back to Local.
									storageArea = chrome.storage.local;
									sendResponse({
										message: "Sync Not Possible - size of Redirects larger than what's allowed by Sync. Refer Help page"
									});
								} else {
									chrome.storage.local.get({
										redirects: []
									}, function (obj) {
										//check if at least one rule is there.
										if (obj.redirects.length>0) {
											chrome.storage.sync.set(obj, function (a) {
												log('redirects moved from Local to Sync Storage Area');
												//Remove Redirects from Local storage
												chrome.storage.local.remove("redirects");
												// Call setupRedirectListener to setup the redirects
												setUpRedirectListener();
												sendResponse({
													message: "sync-enabled"
												});
											});
										} else {
											log('No redirects are setup currently in Local, just enabling Sync');
											sendResponse({
												message: "sync-enabled"
											});
										}
									});
								}
							});
						} else {
						storageArea = chrome.storage.local;
						log('storageArea size for local is ' + storageArea.QUOTA_BYTES / 1000000 + ' MB, that is .. ' + storageArea.QUOTA_BYTES + " bytes");
						chrome.storage.sync.get({
							redirects: []
						}, function (obj) {
							if (obj.redirects.length>0) {
								chrome.storage.local.set(obj, function (a) {
									log('redirects moved from Sync to Local Storage Area');
									//Remove Redirects from sync storage
									chrome.storage.sync.remove("redirects");
									// Call setupRedirectListener to setup the redirects
									setUpRedirectListener();
									sendResponse({
										message: "sync-disabled"
									});
								});
							} else {
								sendResponse({
									message: "sync-disabled"
								});
							}
						});
					}
				});

		} else if (request.type == 'set-rpc-url') {
			log('Setting RPC URL to ' + request.url);
			storageArea.get({redirects: [DEFAULT_REDIRECT]}, function(obj) {
				var redirects = obj.redirects;
				for (var i = 0; i < redirects.length; i++) {
					if (redirects[i].isRPC) {
						redirects[i].exampleResult = request.url;
						redirects[i].redirectUrl = request.url;
					}
				}
				storageArea.set({redirects: redirects}, function() {
					log('RPC URL updated');
					setUpRedirectListener();
				});
			})
		} else {
			log('Unexpected message: ' + JSON.stringify(request));
			return false;
		}

		return true; //This tells the browser to keep sendResponse alive because
		//we're sending the response asynchronously.
	}
);


//First time setup
updateIcon();

chrome.storage.local.get({logging:false}, function(obj) {
	log.enabled = obj.logging;
});

chrome.storage.local.get({
	isSyncEnabled: false
}, function (obj) {
	if (obj.isSyncEnabled) {
		storageArea = chrome.storage.sync;
	} else {
		storageArea = chrome.storage.local;
	}
	// Now we know which storageArea to use, call setupInitial function
	setupInitial();
});

//wrapped the below inside a function so that we can call this once we know the value of storageArea from above.

function setupInitial() {
	chrome.storage.local.get({
		disabled: false
	}, function (obj) {
		if (!obj.disabled) {
			setUpRedirectListener();
		} else {
			log('Redirector is disabled');
		}
	});
}
log('Redirector starting up...');

chrome.runtime.onStartup.addListener(handleStartup);
function handleStartup(){
	updateIcon(); //To set dark/light icon...

	//This doesn't work yet in Chrome, but we'll put it here anyway, in case it starts working...
	let darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
	darkModeMql.onchange = updateIcon;
}
