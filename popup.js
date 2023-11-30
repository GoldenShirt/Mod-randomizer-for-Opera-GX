document.addEventListener('DOMContentLoaded', function() {
  var extensionList = document.getElementById('extensionList');
  var randomizeButton = document.getElementById('randomizeButton');
  var toggleAutoModIdentification = document.getElementById('toggleAutoModIdentification');

  chrome.management.getAll(function(extensions) {
    chrome.storage.local.get('modExtensionIds', function(result) {
      var modExtensionIds = result.modExtensionIds || [];

      extensions.forEach(function(extension) {
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = extension.id;
        checkbox.checked = modExtensionIds.includes(extension.id);

        var label = document.createElement('label');
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(extension.name));

        extensionList.appendChild(label);
      });
    });
  });

  var modForm = document.getElementById('modForm');
  modForm.addEventListener('submit', function(event) {
    event.preventDefault();

    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var modExtensionIds = Array.from(checkboxes)
      .filter(function(checkbox) {
        return checkbox.checked;
      })
      .map(function(checkbox) {
        return checkbox.id;
      });

    // Save the mod extension IDs to local storage
    chrome.storage.local.set({ modExtensionIds: modExtensionIds }, function() {
      // Send a message to the background script
      console.log({ type: 'modExtensionsSaved', data: modExtensionIds });
      window.close(); // Disable this line when changing the code.
    });
  });

  randomizeButton.addEventListener('click', function() {
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    var checkedModExtensions = Array.from(checkboxes).filter(function(checkbox) {
      return checkbox.checked;
    });

    if (checkedModExtensions.length > 0) {
      // Disable all MOD extensions
      checkedModExtensions.forEach(function(extension) {
        chrome.management.setEnabled(extension.id, false);
      });

      // Choose a random MOD extension and enable it
      var randomIndex = Math.floor(Math.random() * checkedModExtensions.length);
      var randomExtension = checkedModExtensions[randomIndex];
      setTimeout(function() {
        chrome.management.setEnabled(randomExtension.id, true);
      }, 100);
    }
  });




 // Add this code to save the state of the "Automatic Mod Identification" checkbox to local storage
toggleAutoModIdentification.addEventListener('change', function() {
  if (toggleAutoModIdentification.checked) {
    // Perform the automatic identification of "mod" extensions
    identifyModExtensions();
    // Save the state of the checkbox to local storage
    chrome.storage.local.set({ autoModIdentificationChecked: true });
  } else {
    chrome.storage.local.set({ autoModIdentificationChecked: false });
  }
});

 // Retrieve the saved state of the "Automatic Mod Identification" checkbox when the popup is opened
chrome.storage.local.get('autoModIdentificationChecked', function(result) {
  toggleAutoModIdentification.checked = result.autoModIdentificationChecked || false;
  if (toggleAutoModIdentification.checked) {
    identifyModExtensions();
  }
});


 // Function to automatically identify "mod" extensions
  function identifyModExtensions() {
    // Retrieve the list of all installed extensions
    chrome.management.getAll(function(extensions) {
      // Filter the extensions to identify the "mod" extensions based on the updateUrl
      var modExtensions = extensions.filter(function(extension) {
        return extension.updateUrl === "https://api.gx.me/store/mods/update";
      });

      // Display or use the identified "mod" extensions as needed
      console.log('Identified Mod Extensions:', modExtensions);
      // You can further process or display the identified "mod" extensions based on your requirements
    });
  }
  
  
  
  
  
  
});