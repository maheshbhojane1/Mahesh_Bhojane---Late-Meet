// Popup Script — AI Meeting Copilot

document.addEventListener('DOMContentLoaded', async () => {
  const setupView = document.getElementById('setup-view');
  const mainView = document.getElementById('main-view');
  const meetingSection = document.getElementById('meeting-section');
  const noMeetingSection = document.getElementById('no-meeting-section');

  // ——— Check if API key is configured ———
  const config = await chrome.storage.local.get(['openai_api_key', 'supabase_url', 'supabase_anon_key']);
  
  if (!config.openai_api_key) {
    setupView.style.display = 'block';
    mainView.style.display = 'none';
  } else {
    setupView.style.display = 'none';
    mainView.style.display = 'block';
  }

  // ——— Setup: Save Keys ———
  document.getElementById('save-keys').addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const supabaseUrl = document.getElementById('supabase-url-input').value.trim();
    const supabaseKey = document.getElementById('supabase-key-input').value.trim();

    if (!apiKey) {
      shakeElement(document.getElementById('api-key-input'));
      return;
    }

    await chrome.storage.local.set({
      openai_api_key: apiKey,
      ...(supabaseUrl && { supabase_url: supabaseUrl }),
      ...(supabaseKey && { supabase_anon_key: supabaseKey })
    });

    setupView.style.display = 'none';
    mainView.style.display = 'block';
  });

  // ——— Toggle API Key Visibility ———
  document.getElementById('toggle-key').addEventListener('click', () => {
    const input = document.getElementById('api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // ——— Settings ———
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ——— Open Dashboard ———
  document.getElementById('open-dashboard')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.sidePanel.open({ tabId: tabs[0].id });
      }
    });
  });

  // ——— Get Current State ———
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state) {
      updateUI(state);
    }
  } catch {
    // No active meeting
  }

  // ——— Listen for State Updates ———
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      updateUI(message.state);
    }
  });

  // ——— Duration Timer ———
  let durationInterval = null;

  function startDurationTimer(startTime) {
    if (durationInterval) clearInterval(durationInterval);
    
    durationInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      document.getElementById('meeting-duration').textContent = formatDuration(elapsed);
    }, 1000);
  }

  // ——— Update UI ———
  function updateUI(state) {
    if (state.isActive) {
      meetingSection.style.display = 'block';
      noMeetingSection.style.display = 'none';
      
      // Status
      const badge = document.getElementById('status-badge');
      badge.className = 'status-badge active';
      badge.querySelector('.status-text').textContent = 'Recording...';
      
      // Meeting ID
      document.getElementById('meeting-id').textContent = state.meetingId || '—';
      
      // Duration
      if (state.startTime) startDurationTimer(state.startTime);
      
      // Summary
      document.getElementById('summary-text').textContent = state.summary || 'Waiting for conversation...';
      
      // Current Topic
      document.getElementById('current-topic').textContent = state.currentTopic || 'Detecting...';
      
      // Stats
      document.getElementById('participant-count').textContent = state.participants?.length || 0;
      document.getElementById('decision-count').textContent = state.decisions?.length || 0;
      document.getElementById('action-count').textContent = state.actionItems?.length || 0;
      document.getElementById('sentiment-icon').textContent = getSentimentEmoji(state.sentiment);
      
      // Topics List
      const topicsList = document.getElementById('topics-list');
      if (state.topics && state.topics.length > 0) {
        topicsList.innerHTML = state.topics.map(t => `
          <div class="topic-item">
            <div class="topic-dot ${t.status || 'active'}"></div>
            <span class="topic-name">${t.name}</span>
            <span class="topic-status ${t.status || 'active'}">${t.status || 'active'}</span>
          </div>
        `).join('');
      }
      
      // Late Joiners
      const lateSection = document.getElementById('late-joiners-section');
      const lateList = document.getElementById('late-joiners-list');
      if (state.lateJoiners && state.lateJoiners.length > 0) {
        lateSection.style.display = 'block';
        lateList.innerHTML = state.lateJoiners.map(name => `
          <div class="late-joiner-item">
            <span class="joiner-icon">🚪</span>
            <span class="joiner-name">${name}</span>
            <span style="color: #64748B; font-size: 10px;">briefed ✓</span>
          </div>
        `).join('');
      }
    } else {
      meetingSection.style.display = 'none';
      noMeetingSection.style.display = 'block';
      
      const badge = document.getElementById('status-badge');
      badge.className = 'status-badge inactive';
      badge.querySelector('.status-text').textContent = 'No active meeting';
      
      if (durationInterval) {
        clearInterval(durationInterval);
        durationInterval = null;
      }
    }
  }

  // ——— Helpers ———
  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function getSentimentEmoji(sentiment) {
    const map = { positive: '😊', negative: '😟', neutral: '😐', mixed: '🤔' };
    return map[sentiment] || '—';
  }

  function shakeElement(el) {
    el.style.borderColor = '#EF4444';
    el.style.animation = 'shake 0.4s ease';
    setTimeout(() => {
      el.style.borderColor = '';
      el.style.animation = '';
    }, 400);
  }
});
