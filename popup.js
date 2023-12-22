document.addEventListener('DOMContentLoaded', function() {
 
  // Get elements by ID
  const extensionList = document.getElementById('extensionList');
  const randomizeButton = document.getElementById('randomizeButton');
  const toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
  const toggleRandomizeOnStartupChecked = document.getElementById('toggleRandomizeOnStartup');
  const modForm = document.getElementById('modForm');
	
  // Event listeners for checkbox state changes
  toggleAutoModIdentification.addEventListener('change', function () {
    handleAutoModIdentificationChange();
  });

  toggleRandomizeOnStartupChecked.addEventListener('change', function () {
    handleRandomizeOnStartupChange();
  });
  
  modForm.addEventListener('submit', function(event) {
    handleFormSubmission(event);
  });
  
  randomizeButton.addEventListener('click', function() {
	  handleRandomizeButtonClick();
  });

  // Retrieve saved state of checkboxes on popup open
  chrome.storage.local.get(['autoModIdentificationChecked', 'toggleRandomizeOnStartupChecked', 'randomizeOnStartup: randomizeOnStartup'], function (result) {
    toggleAutoModIdentification.checked = result.autoModIdentificationChecked || false;
    toggleRandomizeOnStartupChecked.checked = result.toggleRandomizeOnStartupChecked || false;
	
    if (toggleAutoModIdentification.checked) {
      identifyModExtensions();
    } 
	else {
	simplifiedUpdateCheckboxes();
	}
	
  });

  // Function to update checkmarks without variables
  function simplifiedUpdateCheckboxes() {
  chrome.management.getAll(function(extensions) {
    chrome.storage.local.get('modExtensionIds', function(result) {
      var retrievedModExtensionIds = result.modExtensionIds || [];
      updateCheckboxes(extensions, retrievedModExtensionIds);
    });
  });
}

  // Function to update checkboxes based on extension IDs
  function updateCheckboxes(extensions, modExtensionIds) {
  var extensionListContainer = document.getElementById('extensionList');
  // Clear the existing content in case there were checkboxes from a previous state
  extensionListContainer.innerHTML = '';
  
  // Sort extensions alphabetically by name
  extensions.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  
  extensions.forEach(function (extension) {
    if (extension.id !== 'toggleAutoModIdentification' && extension.id !== 'toggleRandomizeOnStartup') {
      var label = document.createElement('label');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = extension.id;
      checkbox.checked = modExtensionIds.includes(extension.id);

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(extension.name));

      extensionListContainer.appendChild(label);
    }
  });
}
  
  // Function to handle form submission
  function handleFormSubmission(event) {
    event.preventDefault();

    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var modExtensionIds = Array.from(checkboxes)
      .filter(function(checkbox) {
        // Exclude both "toggleAutoModIdentification" and "toggleRandomizeOnStartup" checkboxes
        return checkbox.checked && checkbox.id !== 'toggleAutoModIdentification' && checkbox.id !== 'toggleRandomizeOnStartup';
      })
      .map(function(checkbox) {
        return checkbox.id;
      });

    // Save the mod extension IDs to local storage
    chrome.storage.local.set({ modExtensionIds: modExtensionIds }, function() {
      // Send a message to the background script
      console.log({ type: 'modExtensionsSaved', data: modExtensionIds });
      window.close();  // Comment out this line when changing the code.
    });
  }
  
  // Function to handle "Randomize" button click
  function handleRandomizeButtonClick() {
  chrome.storage.local.get('modExtensionIds', function(result) {
    var modExtensionIds = result.modExtensionIds || [];

    if (modExtensionIds.length > 0) {
      disableAndEnableRandomExtension(modExtensionIds);
    }
	else {console.log('Error, mod extensions not found in local storage')
	}
  });
}
 
  // Function to handle "Automatic Mod Identification" checkbox change
  function handleAutoModIdentificationChange() {
    chrome.storage.local.set({ autoModIdentificationChecked: toggleAutoModIdentification.checked });

    if (toggleAutoModIdentification.checked) {
      identifyModExtensions();
    } else {
      simplifiedUpdateCheckboxes();
    }
  }

  // Function to handle "Randomize on Startup" change and save the state
  function handleRandomizeOnStartupChange() {
    var randomizeOnStartup = toggleRandomizeOnStartupChecked.checked;
    chrome.storage.local.set({ toggleRandomizeOnStartupChecked: randomizeOnStartup, randomizeOnStartup: randomizeOnStartup });
    console.log('Randomize on startup is saved as ', randomizeOnStartup);
  }
  
  // Function to automatically identify mod extensions and save them
  function identifyModExtensions() {
    chrome.management.getAll(function (extensions) {
      var modExtensionIds = extensions
        .filter(function (extension) {
          return extension.updateUrl === "https://api.gx.me/store/mods/update";
        })
        .map(function (extension) {
          return extension.id;
        });

      updateCheckboxes(extensions, modExtensionIds);

      chrome.storage.local.set({ modExtensionIds: modExtensionIds }, function () {
        console.log({ type: 'Mod Identification- modExtensionsSaved', data: modExtensionIds });
        
      });
    });
  }

  // Function to disable and enable a random extension
  function disableAndEnableRandomExtension(modExtensionIds) {
  modExtensionIds.forEach(function (extensionId) {
    chrome.management.setEnabled(extensionId, false, function () {
      console.log('Disabled Extension:', extensionId);
    });
  });

  var randomIndex = Math.floor(Math.random() * modExtensionIds.length);
  var randomExtensionId = modExtensionIds[randomIndex];

  setTimeout(function () {
    chrome.management.setEnabled(randomExtensionId, true, function () {
      console.log('Enabled Random Extension:', randomExtensionId);
    });
  }, 100);
}

 
});
