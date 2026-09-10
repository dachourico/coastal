const $ = selector => document.querySelector(selector);
const key = 'coastal-google-calendar';
const calendars = [
  {id: 'tjjhdjgtf9gv9aj3lp0udgfn04@group.calendar.google.com', name: 'Flower 3', color: '#0B8043'},
  {id: 'oq1qkt590dklknhphgacp9ubeo@group.calendar.google.com', name: 'Flower 4', color: '#3F51B5'},
  {id: 'jkajr2s993fpuns6nt12bn8ngo@group.calendar.google.com', name: 'Veg', color: '#8E24AA'},
  {id: 'alexdacosta96@gmail.com', name: 'Service', color: '#D56E0C'},
];
const defaultCalendar = calendars.map(calendar => calendar.id).join(',');
const legacyDefaultCalendar = calendars.slice(0, 3).map(calendar => calendar.id).join(',');
let calendarId = defaultCalendar;

export function parseCalendar(value) {
  if (value.includes(',') && !/^https?:/i.test(value.trim())) return value.split(',').map(part => parseCalendar(part)).join(',');
  let id = value.trim();
  if (/^https?:/i.test(id)) {
    const url = new URL(id);
    if (url.protocol !== 'https:' || !['calendar.google.com', 'www.google.com'].includes(url.hostname) || !url.pathname.startsWith('/calendar/')) {
      throw new Error('Use a Google Calendar ID or a Google Calendar embed link.');
    }
    const sources = url.searchParams.getAll('src');
    if (sources.length !== 1) throw new Error('Copy the Calendar ID from Settings → Integrate calendar.');
    id = sources[0];
  }
  if (!/^[^\s<>"/?#&]+@[^\s<>"/?#&]+$/.test(id) || id.length > 1024) {
    throw new Error('Enter the Calendar ID from Google Calendar settings, such as team@group.calendar.google.com.');
  }
  return id;
}

function message(text, error = false) {
  $('#status').textContent = text;
  $('#status').className = error ? 'error' : '';
}

function render() {
  $('#calendar-frame').replaceChildren();
  $('#calendar-legend').replaceChildren();
  $('#calendar-room').hidden = calendarId !== defaultCalendar;
  $('#calendar-title').textContent = calendarId === defaultCalendar ? 'Team calendar' : 'Work calendar';
  $('#refresh').hidden = $('#disconnect').hidden = !calendarId;
  $('#calendar-view').disabled = !calendarId;
  $('#calendar-source').value = calendarId;
  $('#calendar-settings').open = !calendarId;
  $('#google-link').href = calendarId ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId.split(',')[0])}` : 'https://calendar.google.com/';
  if (!calendarId) { message('Add your work calendar to see upcoming events.'); return; }
  const url = new URL('https://calendar.google.com/calendar/embed');
  url.search = new URLSearchParams({mode: $('#calendar-view').value, ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', showTitle: '0', showPrint: '0'});
  const ids = calendarId === defaultCalendar && $('#calendar-room').value !== 'all' ? [calendarId.split(',')[Number($('#calendar-room').value)]] : calendarId.split(',');
  $('#calendar-legend').replaceChildren();
  for (const [index, id] of ids.entries()) {
    const calendar = calendars.find(calendar => calendar.id === id) || {name: id, color: ['#0B8043', '#3F51B5', '#8E24AA', '#D56E0C'][index % 4]};
    url.searchParams.append('src', id);
    url.searchParams.append('color', calendar.color);
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'calendar-dot';
    dot.style.backgroundColor = calendar.color;
    item.append(dot, document.createTextNode(calendar.name));
    $('#calendar-legend').append(item);
  }
  const frame = document.createElement('iframe');
  frame.title = 'Work Google Calendar';
  frame.src = url.href;
  frame.className = 'google-calendar';
  $('#calendar-frame').append(frame);
  message('Showing the calendar through Google. Event visibility follows your Google sharing permissions.');
}

$('#calendar-form').onsubmit = event => {
  event.preventDefault();
  try {
    const id = parseCalendar($('#calendar-source').value);
    calendarId = id;
    render();
    try { localStorage.setItem(key, id); }
    catch { message('Calendar opened, but this browser could not save the selection. Add it again next visit.', true); }
  } catch (error) { message(error.message, true); }
};
$('#calendar-view').onchange = render;
$('#calendar-room').onchange = render;
$('#refresh').onclick = render;
$('#restore-calendars').onclick = () => {
  try { localStorage.removeItem(key); }
  catch { message('Could not save the default selection. Allow site storage and try again.', true); return; }
  calendarId = defaultCalendar; $('#calendar-room').value = 'all'; render();
};
$('#disconnect').onclick = () => {
  try { localStorage.setItem(key, ''); }
  catch { message('Could not remove the saved calendar. Allow site storage and try again.', true); return; }
  calendarId = ''; render();
};
try {
  const saved = localStorage.getItem(key);
  if (saved !== null) {
    const parsed = saved ? parseCalendar(saved) : '';
    calendarId = parsed === legacyDefaultCalendar ? defaultCalendar : parsed;
  }
} catch { /* Settings remain available when storage is unavailable or invalid. */ }
render();
