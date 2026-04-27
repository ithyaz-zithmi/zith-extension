document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('freelancerName');
  const skillsInput = document.getElementById('skills');
  const defaultTemplateSelect = document.getElementById('defaultTemplate');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  
  chrome.storage.local.get('settings', (result) => {
    if (result.settings) {
      nameInput.value = result.settings.freelancerName || '';
      skillsInput.value = result.settings.skills || '';
      if(result.settings.defaultTemplate) {
        defaultTemplateSelect.value = result.settings.defaultTemplate;
      }
    }
  });
  
  saveBtn.addEventListener('click', () => {
    const newSettings = {
      freelancerName: nameInput.value.trim(),
      skills: skillsInput.value.trim(),
      defaultTemplate: defaultTemplateSelect.value
    };
    chrome.storage.local.set({ settings: newSettings }, () => {
      statusDiv.textContent = 'Settings securely saved.';
      statusDiv.className = 'success';
      statusDiv.style.display = 'block';
      setTimeout(() => { statusDiv.className = ''; statusDiv.style.display = 'none'; }, 3000);
    });
  });
});
