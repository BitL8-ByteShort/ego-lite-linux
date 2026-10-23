const token =
  location.hash.slice(1) ||
  sessionStorage.getItem("ego-controller-token") ||
  "";
if (token) sessionStorage.setItem("ego-controller-token", token);
history.replaceState(null, "", location.pathname);
const feedback = document.querySelector("#feedback");
async function api(action, values = {}) {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ego-token": token },
    body: JSON.stringify({ action, ...values }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
async function run(action, values) {
  try {
    const result = await api(action, values);
    feedback.textContent = result.message || "Done";
    await refresh();
  } catch (error) {
    feedback.textContent = error.message;
  }
}
async function refresh() {
  try {
    const status = await api("status");
    document.querySelector("#profile").textContent =
      `Profile: ${status.profile}`;
    const select = document.querySelector("#profiles");
    const previous = select.value;
    select.replaceChildren(
      ...status.profiles.map((profile) => {
        const option = document.createElement("option");
        option.value = profile;
        option.textContent = profile;
        return option;
      }),
    );
    select.value = previous || status.profile;
    const inbox = document.querySelector("#inbox");
    inbox.replaceChildren(
      ...(status.inbox || []).map((tab) => {
        const row = document.createElement("div");
        row.className = "actions";
        const title = document.createElement("p");
        title.textContent = tab.title || "Untitled tab";
        const taskSelect = document.createElement("select");
        taskSelect.setAttribute("aria-label", "Assign tab to task");
        for (const task of status.tasks) {
          const option = document.createElement("option");
          option.value = task.id;
          option.textContent = task.name;
          taskSelect.append(option);
        }
        const assign = document.createElement("button");
        assign.textContent = "Assign to task";
        assign.disabled = !status.tasks.length;
        assign.addEventListener("click", () =>
          run("assignInbox", {
            id: Number(taskSelect.value),
            targetId: tab.targetId,
          }),
        );
        row.append(title, taskSelect, assign);
        return row;
      }),
    );
    const tasks = document.querySelector("#tasks");
    tasks.replaceChildren(
      ...status.tasks.map((task) => {
        const box = document.createElement("article");
        box.className = "task";
        const title = document.createElement("h3");
        title.textContent = task.name;
        const state = document.createElement("p");
        state.textContent = `${task.ownership === "agent" ? "Agent" : "You"} · ${task.state} · ${task.hardPaused ? "Paused by you" : task.agentId}`;
        const tabs = document.createElement("p");
        tabs.textContent = task.recentTabTitles.join(" · ");
        const actions = document.createElement("div");
        actions.className = "actions";
        for (const [label, action] of [
          ["Reveal", "reveal"],
          ["Take control", "takeControl"],
          ["Resume agent", "resume"],
          ["Close task", "close"],
        ]) {
          const button = document.createElement("button");
          button.textContent = label;
          button.addEventListener("click", () => run(action, { id: task.id }));
          actions.append(button);
        }
        const grant = document.createElement("form");
        const identity = document.createElement("input");
        identity.name = "agentId";
        identity.placeholder = "Agent workflow identity";
        identity.setAttribute("aria-label", "Agent workflow identity");
        identity.required = true;
        identity.value = task.agentId || "";
        const grantButton = document.createElement("button");
        grantButton.textContent = "Grant agent";
        grant.append(identity, grantButton);
        grant.addEventListener("submit", (event) => {
          event.preventDefault();
          run("grant", { id: task.id, agentId: identity.value });
        });
        box.append(title, state, tabs, actions, grant);
        if (task.lastError) {
          const error = document.createElement("p");
          error.textContent = task.lastError;
          box.append(error);
        }
        return box;
      }),
    );
  } catch (error) {
    feedback.textContent = error.message;
  }
}
for (const action of ["personal", "pauseAll", "stop"])
  document
    .querySelector(`#${action}`)
    .addEventListener("click", () => run(action));
document
  .querySelector("#openProfile")
  .addEventListener("click", () =>
    run("openProfile", { profile: document.querySelector("#profiles").value }),
  );
for (const [id, action] of [
  ["newProfile", "createProfile"],
  ["newTask", "createTask"],
])
  document.querySelector(`#${id}`).addEventListener("submit", (event) => {
    event.preventDefault();
    run(action, Object.fromEntries(new FormData(event.target)));
    event.target.reset();
  });
refresh();
setInterval(refresh, 2000);
