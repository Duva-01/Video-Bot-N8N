(function () {
  const form = document.getElementById("loginForm");
  const message = document.getElementById("message");
  const submit = form.querySelector("button[type='submit']");
  const nextField = document.getElementById("next");
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "/?view=dashboard";
  nextField.value = next;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submit.disabled = true;

    const payload = {
      username: document.getElementById("username").value.trim(),
      password: document.getElementById("password").value,
      next,
    };

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo iniciar sesion");
      }

      window.location.href = data.redirect || "/";
    } catch (error) {
      message.textContent = error.message;
      submit.disabled = false;
    }
  });
})();
