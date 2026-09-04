const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authStatus = document.getElementById("authStatus");

loginForm?.addEventListener("submit", (event) => submitAuth(event, "/api/login", "loginUsername", "loginPassword"));
registerForm?.addEventListener("submit", (event) => submitAuth(event, "/api/register", "registerUsername", "registerPassword"));

async function submitAuth(event, endpoint, usernameId, passwordId) {
  event.preventDefault();
  authStatus.textContent = "PLEASE WAIT…";
  const username = document.getElementById(usernameId).value.trim();
  const password = document.getElementById(passwordId).value;
  const users = JSON.parse(localStorage.getItem("look-at-me-users") || "{}");
  if (endpoint.endsWith("/api/register")) {
    if (users[username]) {
      authStatus.textContent = "USERNAME ALREADY EXISTS.";
      return;
    }
    users[username] = password;
    localStorage.setItem("look-at-me-users", JSON.stringify(users));
    localStorage.setItem("look-at-me-user", username);
    window.location.href = "../index.html";
    return;
  }
  if (users[username] !== password) {
    authStatus.textContent = "INVALID USERNAME OR PASSWORD.";
    return;
  }
  localStorage.setItem("look-at-me-user", username);
  window.location.href = "../index.html";
  return;
  /* try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Authentication failed.");
    window.location.href = "/index.html";
  } catch (error) {
    authStatus.textContent = error.message;
  } */
}
