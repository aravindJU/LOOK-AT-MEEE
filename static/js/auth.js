const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authStatus = document.getElementById("authStatus");

loginForm.addEventListener("submit", (event) => submitAuth(event, "/api/login", "loginUsername", "loginPassword"));
registerForm.addEventListener("submit", (event) => submitAuth(event, "/api/register", "registerUsername", "registerPassword"));

async function submitAuth(event, endpoint, usernameId, passwordId) {
  event.preventDefault();
  authStatus.textContent = "PLEASE WAIT…";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById(usernameId).value,
        password: document.getElementById(passwordId).value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Authentication failed.");
    window.location.href = "/";
  } catch (error) {
    authStatus.textContent = error.message;
  }
}
