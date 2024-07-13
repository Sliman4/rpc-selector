var storage = chrome.storage.local;
var viewModel = {}; //Just an object for the databinding

function applyBinding() {
	dataBind(document.body, viewModel);
}

function toggle(prop) {
	storage.get({[prop]: false}, function(obj) {
		storage.set({[prop] : !obj[prop]});
		viewModel[prop] = !obj[prop];
		applyBinding();
	});
}



function openRedirectorSettings() {

	//switch to open one if we have it to minimize conflicts
	var url = chrome.extension.getURL('redirector.html');

	//FIREFOXBUG: Firefox chokes on url:url filter if the url is a moz-extension:// url
	//so we don't use that, do it the more manual way instead.
	chrome.tabs.query({currentWindow:true}, function(tabs) {
		for (var i=0; i < tabs.length; i++) {
			if (tabs[i].url == url) {
				chrome.tabs.update(tabs[i].id, {active:true}, function(tab) {
					close();
				});
				return;
			}
		}

		chrome.tabs.create({url:url, active:true});
	});
	return;
};


function pageLoad() {
	storage.get({logging:false, enableNotifications:false, disabled: false}, function(obj) {
		viewModel = obj;
		applyBinding();
	})

	el('#enable-logging').addEventListener('input', () => toggle('logging'));
	el('#toggle-disabled').addEventListener('click', () => toggle('disabled'));
	el('#open-redirector-settings').addEventListener('click', openRedirectorSettings);

	el("#rpc-near-org").addEventListener('click', () => setRpcUrl("https://rpc.mainnet.near.org/"));
	el("#rpc-lava").addEventListener('click', () => setRpcUrl("https://near.lava.build/"));
	el("#rpc-fastnear").addEventListener('click', () => setRpcUrl("https://free.rpc.fastnear.com/"));
	el("#rpc-near-org-beta").addEventListener('click', () => setRpcUrl("https://beta.rpc.mainnet.near.org/"));
	el("#rpc-ankr").addEventListener('click', () => setRpcUrl("https://rpc.ankr.com/near/"));
	el("#rpc-shitzu").addEventListener('click', () => setRpcUrl("https://rpc.shitzuapes.xyz/"));
	const inputField = el("#rpc-url");
	inputField.addEventListener('input', () => {
		setRpcUrl(inputField.value);
	});

	storage.get({rpcRedirect:"https://near.lava.build/lava-referer-013c0d3c-d2c5-4078-b927-5fe046e6668d/"}, function(obj) {
		setRpcUrl(obj.rpcRedirect);
	})
}

function setRpcUrl(url) {
	el("#rpc-url").value = url;
	el("#current-rpc").innerText = url;
	storage.set({rpcRedirect: url});
	chrome.runtime.sendMessage({type: "set-rpc-url", url: url});
}

pageLoad();
//Setup page...
