(() => {
  const authArea = document.getElementById('authArea');
  if (!authArea) return;

  const apiOrigin = location.hostname === 'localhost' && location.port === '8000'
    ? 'http://localhost:3000'
    : '';

  fetch(`${apiOrigin}/auth/me`, { credentials: 'include', cache: 'no-store' })
    .then((response) => response.json())
    .then(({ user }) => {
      if (!user) return;
      const profile = document.createElement('span');
      profile.className = 'fisco-user';
      if (user.avatar) {
        const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
        const avatar = document.createElement('img');
        avatar.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=64`;
        avatar.alt = '';
        profile.appendChild(avatar);
      }
      const name = document.createElement('span');
      name.textContent = user.username || 'Usuário';
      const logout = document.createElement('a');
      logout.href = `${apiOrigin}/auth/logout`;
      logout.textContent = 'Sair';
      profile.append(name, logout);
      authArea.replaceChildren(profile);
    })
    .catch(() => undefined);
})();