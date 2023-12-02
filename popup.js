document.addEventListener('DOMContentLoaded', function() {
var extensionList = document.getElementById('extensionList');
var randomizeButton = document.getElementById('randomizeButton');
var toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');
var toggleRandomizeOnStartupChecked = document.getElementById('toggleRandomizeOnStartup');

chrome.management.getAll(function(extensions) {
  chrome.storage.local.get('modExtensionIds', function(result) {
    var retrievedModExtensionIds = result.modExtensionIds || [];

    extensions.forEach(function(extension) {
      if (extension.id !== 'toggleAutoModIdentification' && extension.id !== 'toggleRandomizeOnStartupChecked') { // Skip the toggleAutoModIdentification button and toggleRandomizeOnStartupChecked button
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = retrievedModExtensionIds.includes(extension.id);

        var label = document.createElement('label');
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(extension.name));

        extensionList.appendChild(label);
      }
    });
	
	 updateCheckboxes(retrievedModExtensionIds);
	
  });
});



toggleRandomizeOnStartup.addEventListener('change', function () {
    var randomizeOnStartup = toggleRandomizeOnStartupChecked.checked;
    console.log('Checkbox changed to:', randomizeOnStartup);
    chrome.storage.local.set({ toggleRandomizeOnStartupChecked: randomizeOnStartup , randomizeOnStartup: randomizeOnStartup});

    console.log('Randomize on startup is saved as ', randomizeOnStartup);
});


chrome.storage.local.get('toggleRandomizeOnStartupChecked', function (result) {
    console.log('Randomize startup: Retrieved from local storage:', result.toggleRandomizeOnStartupChecked);
    toggleRandomizeOnStartupChecked.checked = result.toggleRandomizeOnStartupChecked || false;
   
});






var modForm = document.getElementById('modForm');
modForm.addEventListener('submit', function(event) {
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
    window.close();  // Disable this line when changing the code.
  });
});




  //Randomize button

randomizeButton.addEventListener('click', function() {
 

  var extensionCheckboxes = document.querySelectorAll('input[type="checkbox"]:not(#toggleRandomizeOnStartup):not(#toggleRandomizeOnStartupChecked):not(#toggleAutoModIdentification)');
  var checkedExtensions = Array.from(extensionCheckboxes).filter(function(checkbox) {
    return checkbox.checked;
  });

  console.log('Checked Extensions:', checkedExtensions);

  if (checkedExtensions.length > 0) {
    // Disable all MOD extensions
    checkedExtensions.forEach(function(extension) {
      chrome.management.setEnabled(extension.id, false).then(function() {
        console.log('Disabled Extension:', extension.id);
      }).catch(function(error) {
        console.error('Failed to disable extension:', extension.id, error);
      });
    });

    // Choose a random MOD extension and enable it
    var randomIndex = Math.floor(Math.random() * checkedExtensions.length);
    var randomExtension = checkedExtensions[randomIndex];

    setTimeout(function() {
      chrome.management.setEnabled(randomExtension.id, true).then(function() {
        console.log('Enabled Random Extension:', randomExtension.id);
      }).catch(function(error) {
        console.error('Failed to enable random extension:', randomExtension.id, error);
      });
    }, 100);
  }
});





  
  

 // Function to update checkboxes based on extension IDs
function updateCheckboxes(modExtensionIds) {
  var checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(function (checkbox) {
    // Exclude checkboxes with specific IDs
    if (checkbox.id !== 'toggleRandomizeOnStartup' && checkbox.id !== 'toggleAutoModIdentification') {
      checkbox.checked = modExtensionIds.includes(checkbox.id);
      //Logs to make sure which checkboxes its updating.	console.log('Checkbox ID:', checkbox.id, 'Updated:', checkbox.checked);
    }
  });
}






// Function to automatically identify "mod" extensions and update the checkbox states.
function identifyModExtensions() {
  // Retrieve the list of all installed extensions
  chrome.management.getAll(function (extensions) {
    // Filter the extensions to identify the "mod" extensions based on the updateUrl
    var modExtensionIds = extensions
      .filter(function (extension) {
        return extension.updateUrl === "https://api.gx.me/store/mods/update";
      })
      .map(function (extension) {
        return extension.id;
      });

    // Display or use the identified "mod" extension IDs as needed
    console.log('Mod Identifier: Identified Mod Extension IDs:', modExtensionIds);

    // Update the checkbox states
    updateCheckboxes(modExtensionIds);

    // Save the modExtensionIds to local storage or perform other actions
    chrome.storage.local.set({ modExtensionIds: modExtensionIds }, function () {
      // Send a message to the background script
      console.log({ type: 'Mod Identification- modExtensionsSaved', data: modExtensionIds });
      
      // After saving, recheck the state of the "Automatic Mod Identification" checkbox
      chrome.storage.local.get('autoModIdentificationChecked', function (result) {
        toggleAutoModIdentification.checked = result.autoModIdentificationChecked || false;
      });
    });
  });
}

// Event listener for the checkbox change event
toggleAutoModIdentification.addEventListener('change', function () {
  // Save the state of the checkbox to local storage
  chrome.storage.local.set({ autoModIdentificationChecked: toggleAutoModIdentification.checked });

  if (toggleAutoModIdentification.checked) {
    // If "Automatic Mod Identification" is checked, perform the automatic identification
    identifyModExtensions();
  } else {
    // If "Automatic Mod Identification" is unchecked, manually update the checkboxes
    chrome.storage.local.get('modExtensionIds', function (result) {
      var modExtensionIds = result.modExtensionIds || [];
      updateCheckboxes(modExtensionIds);
    });
  }
});










// Retrieve the saved state of the "Automatic Mod Identification" checkbox when the popup is opened
chrome.storage.local.get('autoModIdentificationChecked', function (result) {
  toggleAutoModIdentification.checked = result.autoModIdentificationChecked || false;

  // If "Automatic Mod Identification" is checked, perform the automatic identification
  if (toggleAutoModIdentification.checked) {
    identifyModExtensions();
  }
});




  
   
  
  
  
});