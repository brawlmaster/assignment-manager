// Mobile device detection and redirect
(function() {
    // Check if user is on mobile device
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               window.innerWidth <= 768;
    }

    // Check if user is already on mobile page
    function isOnMobilePage() {
        return window.location.pathname.includes('mobile.html') || 
               window.location.pathname.endsWith('mobile');
    }

    // Check if user has explicitly chosen desktop version
    function hasDesktopPreference() {
        return localStorage.getItem('preferDesktop') === 'true';
    }

    // Set desktop preference
    function setDesktopPreference() {
        localStorage.setItem('preferDesktop', 'true');
    }

    // Redirect to mobile version
    function redirectToMobile() {
        if (!isOnMobilePage() && !hasDesktopPreference()) {
            window.location.href = 'mobile.html';
        }
    }

    // Add desktop link to mobile page
    function addDesktopLink() {
        if (isOnMobilePage()) {
            const desktopLink = document.createElement('a');
            desktopLink.href = 'index.html';
            desktopLink.textContent = 'Desktop Version';
            desktopLink.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(255, 255, 255, 0.1);
                color: white;
                padding: 8px 12px;
                border-radius: 8px;
                text-decoration: none;
                font-size: 12px;
                z-index: 10000;
                backdrop-filter: blur(10px);
            `;
            desktopLink.addEventListener('click', setDesktopPreference);
            document.body.appendChild(desktopLink);
        }
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            redirectToMobile();
            addDesktopLink();
        });
    } else {
        redirectToMobile();
        addDesktopLink();
    }
})();