export async function askHelper(userText, history) {
  let response;
  try {
    response = await fetch('./api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: userText, history }),
    });
  } catch {
    return { ok: false, text: "I couldn't reach the internet just now. Please check the connection and try again." };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, text: 'Sorry, something went wrong on my end.' };
  }

  if (!response.ok) {
    return { ok: false, text: data.text || 'Sorry, something went wrong.' };
  }

  return { ok: true, text: data.text };
}
