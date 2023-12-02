let randomizeOnStartup;
chrome.runtime.onInstalled.addListener(function () {
  // Set initial value for modExtensionIds in storage
  randomizeOnStartup = true;
  chrome.storage.local.set({ modExtensionIds: [], randomizeOnStartup: randomizeOnStartup , autoModIdentificationChecked: true}, function () {
    console.log('Mod Randomizer: Extension installed. Initializing settings. randomizeOnStartup is set to ', randomizeOnStartup, ' autoModIdentification is set to ' , true);
  });
});

chrome.runtime.onStartup.addListener(function () {
  // Run your startup logic here
  console.log('Running startup code');
  runStartupLogic();
});

function runStartupLogic() {
  // Use a default value if randomizeOnStartup is not defined
  randomizeOnStartup = randomizeOnStartup !== undefined ? randomizeOnStartup : true;

  console.log('After setting default: randomizeOnStartup is set to ', randomizeOnStartup);

  chrome.storage.local.get({ randomizeOnStartup: randomizeOnStartup }, function (result) {
    // Use the global variable instead of declaring a new one
    randomizeOnStartup = result.randomizeOnStartup;
    console.log('Result startup setting overiding default: set to ', result.randomizeOnStartup);

    

  

    if (randomizeOnStartup === true) {
		
      // Retrieve mod extension IDs from local storage
      chrome.storage.local.get('modExtensionIds', function (result) {
        const modExtensionIds = result.modExtensionIds || [];

        // Get all installed extensions
        chrome.management.getAll(function (extensions) {
          // Filter for mod extensions based on stored IDs
          const modExtensions = extensions.filter(extension => modExtensionIds.includes(extension.id));

          console.log('Mod Randomizer: Mod Extensions identified:', modExtensions);

          if (modExtensions.length > 0) {
            // Randomly select a mod extension
            const randomIndex = Math.floor(Math.random() * modExtensions.length);
            const selectedExtension = modExtensions[randomIndex];
            console.log('Mod Randomizer: Randomly selected mod extension:', selectedExtension);

            // Disable all mod extensions sequentially
            modExtensions.forEach(function (extension) {
              if (extension.id !== selectedExtension.id) {
                chrome.management.setEnabled(extension.id, false, function () {
                  console.log('Mod Randomizer: Disabled mod extension:', extension.name);
                });
              }
            });

            // Enable the randomly selected mod extension
            if (!selectedExtension.enabled) {
              chrome.management.setEnabled(selectedExtension.id, true, function () {
                console.log('Mod Randomizer: Enabled selected mod extension:', selectedExtension.name);
              });
            }
          }
        });
      });
    }
  });
  
  
 
};
