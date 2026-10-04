'use strict';

const $ = (id) => document.getElementById(id);
const state = { token: null, outputRoot: '', job: null, sites: [], toastTimer: null };
const busy = (job) => job && ['running', 'cancelling'].includes(job.status);
const labels = {
  completed: 'Completed',
  partial: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
  running: 'Running',
  cancelling: 'Cancelling',
};

function size(bytes) {
  if (!bytes) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 3500);
}

function connection(online) {
  $('connection').replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  $('connection').append(dot, document.createTextNode(online ? 'Server online' : 'Reconnecting…'));
}

async function api(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Extractor-Token': state.token || '',
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function fileUrl(id, relative) {
  return `/files/${encodeURIComponent(id)}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function siteName(alias) {
  return state.sites.find((site) => site.alias === alias)?.name || alias;
}
function collectionName(batch) {
  return batch.config.allsite ? 'All sources' : siteName(batch.config.site);
}
function date(value) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function eventMessage(event) {
  if (event.type === 'started') return 'Created batch folder';
  if (event.type === 'searching') return `Searching ${siteName(event.site)}…`;
  if (event.type === 'found') return `Found ${event.count} posts on ${siteName(event.site)}`;
  if (event.type === 'error') return event.message;
  if (event.type === 'file')
    return `${event.file.status}: ${event.file.path || event.file.error || event.file.reason}`;
  if (event.type === 'finished')
    return `Batch ${labels[event.status]?.toLowerCase() || event.status}`;
  return null;
}

function renderJob(job) {
  state.job = job;
  const running = busy(job);
  $('idle-state').hidden = true;
  $('active-state').hidden = false;
  $('start-button').disabled = running;
  $('start-button').firstChild.textContent = running
    ? 'Extraction in progress '
    : 'Start extraction ';
  $('job-state').textContent = (labels[job.status] || job.status).toUpperCase();
  $('job-state').dataset.state = job.status;
  $('job-source').textContent = collectionName(job).toUpperCase();
  const searching = [...job.events].reverse().find((event) => event.type === 'searching');
  $('job-message').textContent =
    job.status === 'cancelling'
      ? 'Finishing active transfers…'
      : running
        ? job.found
          ? 'Bringing your files home'
          : 'Searching for posts…'
        : job.status === 'completed' && job.found === 0
          ? 'No posts found'
          : labels[job.status] || job.status;
  const searchError =
    !running && job.status === 'failed'
      ? job.events.find((event) => event.type === 'error')?.message
      : null;
  $('job-detail').textContent =
    job.error ||
    searchError ||
    (running
      ? `Source: ${siteName(searching?.site || job.config.site)}`
      : `${job.downloaded} files saved${job.found === 0 ? '. Try another source or fewer tags.' : ' to your local batch folder.'}`);
  for (const metric of ['downloaded', 'found', 'failed', 'skipped'])
    $('metric-' + metric).textContent = job[metric];
  $('job-progress').max = job.found || 1;
  $('job-progress').value = job.processed;
  $('progress-text').textContent = job.found
    ? `${job.processed} of ${job.found} posts processed`
    : 'Waiting for search results';
  if (!running && !job.found) $('progress-text').textContent = 'No files to download';
  $('progress-size').textContent = size(job.bytes);
  $('live-label').hidden = !running;
  const log = $('activity-log');
  const nearBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.replaceChildren();
  for (const event of job.events) {
    const message = eventMessage(event);
    if (!message) continue;
    const line = document.createElement('div');
    line.className = `log-line ${event.file?.status || event.type}`;
    const time = document.createElement('time');
    time.textContent = new Date(event.time).toLocaleTimeString([], { hour12: false });
    const text = document.createElement('span');
    text.textContent = message;
    line.append(time, text);
    log.append(line);
  }
  if (nearBottom) log.scrollTop = log.scrollHeight;
  $('cancel-button').hidden = !running;
  $('cancel-button').disabled = job.status === 'cancelling';
  $('view-job-button').hidden = running || !job.batchId;
}

async function pollJob(id) {
  if (state.job?.id !== id) return;
  try {
    const job = await api(`/api/jobs/${id}`);
    connection(true);
    renderJob(job);
    if (busy(job)) setTimeout(() => pollJob(id), 1000);
    else await refreshBatches();
  } catch (error) {
    connection(false);
    $('job-detail').textContent = error.message;
    setTimeout(() => pollJob(id), 3000);
  }
}

async function refreshBatches() {
  const batches = await api('/api/batches');
  $('batch-count').textContent = batches.length;
  $('history-count').textContent = batches.length;
  $('history-empty').hidden = batches.length > 0;
  $('history-table').hidden = batches.length === 0;
  $('history-rows').replaceChildren();
  for (const batch of batches) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const title = document.createElement('strong');
    title.textContent = collectionName(batch);
    const tags = document.createElement('small');
    tags.textContent = batch.config.tags.join(', ') || 'All tags';
    tags.title = tags.textContent;
    name.append(title, tags);
    row.append(name);
    for (const value of [date(batch.startedAt), `${batch.downloaded} files`, size(batch.bytes)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'batch-status';
    badge.dataset.state = batch.status;
    badge.textContent = batch.status.toUpperCase();
    status.append(badge);
    row.append(status);
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-button';
    button.textContent = 'View ↗';
    button.setAttribute(
      'aria-label',
      `View ${collectionName(batch)} batch from ${date(batch.startedAt)}`,
    );
    button.addEventListener('click', () => showBatch(batch.id));
    action.append(button);
    row.append(action);
    $('history-rows').append(row);
  }
}

async function showBatch(id) {
  try {
    const batch = await api(`/api/batches/${encodeURIComponent(id)}`);
    $('dialog-title').textContent = collectionName(batch);
    $('dialog-summary').textContent =
      `${date(batch.startedAt)} · ${labels[batch.status] || batch.status} · ${batch.config.tags.join(', ') || 'All tags'}`;
    const failures = [
      ...batch.errors,
      ...batch.files
        .filter((file) => file.status === 'failed')
        .map((file) => `${file.site}: ${file.error}`),
    ];
    $('dialog-errors').textContent = failures.slice(0, 10).join(' · ');
    $('dialog-errors').hidden = failures.length === 0;
    $('manifest-link').href = fileUrl(batch.id, 'manifest.json') + '?download';
    const files = batch.files.filter((file) => file.status === 'downloaded');
    $('dialog-file-count').textContent = `${files.length} files · ${size(batch.bytes)}`;
    $('dialog-empty').hidden = files.length > 0;
    $('file-grid').replaceChildren();
    for (const file of files) {
      const card = document.createElement('article');
      card.className = 'file-card';
      const url = fileUrl(batch.id, file.path);
      if (/\.(jpe?g|png|gif|webp|avif)$/i.test(file.path)) {
        const image = document.createElement('img');
        image.src = url;
        image.loading = 'lazy';
        image.alt = `${siteName(file.site)} post ${file.id || file.index}`;
        card.append(image);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'file-placeholder';
        placeholder.textContent = file.path.split('.').pop().toUpperCase();
        card.append(placeholder);
      }
      const info = document.createElement('div');
      info.className = 'file-info';
      const filename = document.createElement('p');
      filename.textContent = file.path.split('/').pop();
      filename.title = file.path;
      const details = document.createElement('small');
      details.textContent = `${siteName(file.site)} · ${size(file.bytes)}`;
      const link = document.createElement('a');
      link.href = url + '?download';
      link.download = '';
      link.textContent = 'Download file ↓';
      info.append(filename, details, link);
      card.append(info);
      $('file-grid').append(card);
    }
    if (!$('batch-dialog').open) $('batch-dialog').showModal();
  } catch (error) {
    toast(error.message);
  }
}

function syncOptions() {
  $('site').disabled = $('allsite').checked;
  $('organized').disabled = $('allsite').checked;
  for (const button of document.querySelectorAll('[data-amount]'))
    button.classList.toggle('selected', button.dataset.amount === $('amount').value);
}

function navigate(batches) {
  $('extract-workspace').hidden = batches;
  $('nav-extract').classList.toggle('active', !batches);
  $('nav-batches').classList.toggle('active', batches);
  $('nav-extract').setAttribute('aria-current', batches ? 'false' : 'page');
  $('nav-batches').setAttribute('aria-current', batches ? 'page' : 'false');
  $('page-title').textContent = batches ? 'Your saved collections.' : 'Start a new extraction.';
  $('page-description').textContent = batches
    ? 'Every batch, right where you left it. Browse your locally saved files.'
    : 'Pick a source, add your tags, and bring your next batch home.';
  $('batches-heading').textContent = batches ? 'Saved batches' : 'Recent batches';
}

$('extract-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('form-error').hidden = true;
  $('start-button').disabled = true;
  const config = {
    site: $('site').value,
    tags: $('tags').value,
    random: $('random').checked,
    organized: $('organized').checked,
    allsite: $('allsite').checked,
  };
  for (const key of ['amount', 'concurrency', 'maxFileSizeMB', 'retries', 'timeout'])
    config[key] = Number($(key).value);
  config.timeout *= 1000;
  try {
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify(config) });
    renderJob(job);
    pollJob(job.id);
  } catch (error) {
    $('form-error').textContent = error.message;
    $('form-error').hidden = false;
    $('start-button').disabled = busy(state.job);
  }
});
$('cancel-button').addEventListener('click', async () => {
  if (!state.job) return;
  try {
    renderJob(await api(`/api/jobs/${state.job.id}/cancel`, { method: 'POST', body: '{}' }));
  } catch (error) {
    toast(error.message);
  }
});
$('view-job-button').addEventListener('click', () => {
  if (state.job?.batchId) showBatch(state.job.batchId);
});
$('refresh-batches').addEventListener('click', () =>
  refreshBatches().catch((error) => toast(error.message)),
);
$('close-dialog').addEventListener('click', () => $('batch-dialog').close());
$('batch-dialog').addEventListener('click', (event) => {
  const bounds = $('batch-dialog').getBoundingClientRect();
  if (
    event.target === $('batch-dialog') &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  )
    $('batch-dialog').close();
});
$('nav-extract').addEventListener('click', () => navigate(false));
$('nav-batches').addEventListener('click', () => {
  navigate(true);
  refreshBatches().catch((error) => toast(error.message));
});
$('copy-path').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.outputRoot);
    toast('Output folder path copied');
  } catch {
    toast(`Output folder: ${state.outputRoot}`);
  }
});
$('allsite').addEventListener('change', syncOptions);
$('amount').addEventListener('input', syncOptions);
for (const button of document.querySelectorAll('[data-amount]'))
  button.addEventListener('click', () => {
    $('amount').value = button.dataset.amount;
    syncOptions();
  });

async function init() {
  try {
    const { defaults, sites, outputRoot, token } = await api('/api/config');
    Object.assign(state, { sites, outputRoot, token });
    $('site').replaceChildren();
    for (const site of sites) {
      const option = document.createElement('option');
      option.value = site.alias;
      option.textContent = `${site.name} — ${site.domain}`;
      $('site').append(option);
    }
    $('site').value = defaults.site;
    $('tags').value = defaults.tags.join(' ');
    for (const key of ['amount', 'concurrency', 'maxFileSizeMB', 'retries'])
      $(key).value = defaults[key];
    $('timeout').value = defaults.timeout / 1000;
    for (const key of ['random', 'organized', 'allsite']) $(key).checked = defaults[key];
    $('output-path').textContent = outputRoot;
    $('output-path').title = outputRoot;
    syncOptions();
    $('start-button').disabled = false;
    connection(true);
    await refreshBatches();
    const jobs = await api('/api/jobs');
    const job = jobs.find(busy) || jobs[0];
    if (job) {
      renderJob(job);
      if (busy(job)) pollJob(job.id);
    }
  } catch (error) {
    connection(false);
    $('form-error').textContent = error.message;
    $('form-error').hidden = false;
    $('start-button').disabled = true;
  }
}
init();
