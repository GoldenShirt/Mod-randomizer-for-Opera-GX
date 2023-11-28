chrome.runtime.onInstalled.addListener(function () {
  // Set initial value for modExtensionIds in storage
  chrome.storage.local.set({ modExtensionIds: [] }, function () {
    console.log('Mod extensions initialized');
  });
});

chrome.runtime.onStartup.addListener(function() {
  // Code to enable a random mod
});

chrome.management.onInstalled.addListener(function (extension) {
  checkIfMod(extension.id, function (isMod) {
    extension.isMod = isMod;
  });
});

chrome.management.getAll(function (extensions) {
  var modExtensions = extensions.filter(function (extension) {
    return extension.isMod;
  });

  if (modExtensions.length > 0) {
    // Randomly select a mod extension
    var randomIndex = Math.floor(Math.random() * modExtensions.length);
    var selectedExtension = modExtensions[randomIndex];

    // Disable all other mod extensions
    modExtensions.forEach(function (extension) {
      if (extension.id !== selectedExtension.id) {
        chrome.management.setEnabled(extension.id, false);
      }
    });

    // Enable the selected mod extension
    chrome.management.setEnabled(selectedExtension.id, true);
  }
});

function checkIfMod(extensionId, callback) {
  chrome.storage.local.get('modExtensionIds', function (result) {
    var modExtensionIds = result.modExtensionIds || [];
    var isMod = modExtensionIds.includes(extensionId);
    
    if (typeof callback === 'function') {
      callback(isMod);
    }
  });
}