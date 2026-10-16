const defaultBase = import.meta.env.VITE_API_BASE_URL || "/api";

const toUrl = (path) => {
  if (!path.startsWith("/")) {
    return `${defaultBase}/${path}`;
  }
  if (defaultBase.endsWith("/") && path.startsWith("/")) {
    return `${defaultBase}${path.slice(1)}`;
  }
  return `${defaultBase}${path}`;
};

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: text };
  }
};

const handleResponse = async (response) => {
  const data = await parseJson(response);
  if (!response.ok) {
    const error = data?.error || response.statusText;
    throw new Error(error);
  }
  return data;
};

const jsonHeaders = { "Content-Type": "application/json" };

export const apiGet = async (path) => {
  const response = await fetch(toUrl(path), {
    headers: jsonHeaders,
  });
  return handleResponse(response);
};

export const apiPost = async (path, body) => {
  const response = await fetch(toUrl(path), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body ?? {}),
  });
  return handleResponse(response);
};

export const apiPut = async (path, body) => {
  const response = await fetch(toUrl(path), {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(body ?? {}),
  });
  return handleResponse(response);
};

export const fetchTeams = () => apiGet("/teams");
export const fetchTeam = (teamId) => apiGet(`/teams/${teamId}`);
export const fetchPlayers = () => apiGet("/players");
export const savePlayer = (payload) => apiPost("/players", payload);
export const updateExistingPlayer = (playerId, payload) => apiPut(`/players/${playerId}`, payload);
export const runTradeSimulation = (payload) => apiPost("/trade", payload);
export const runGameSimulation = (payload) => apiPost("/simulate", payload);
export const calculateOverall = (payload) => apiPost("/overall", payload);
