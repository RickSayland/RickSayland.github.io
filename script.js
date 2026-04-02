// Blog posts data structure
const blogPosts = [
    {
        id: 1,
        title: "Understanding Macronutrients for Muscle Gain",
        excerpt: "Learn how to balance protein, carbs, and fats to maximize muscle growth and recovery.",
        date: "2024-04-02",
        icon: "🥗",
        slug: "macronutrients-muscle-gain",
        featured: true
    },
    {
        id: 2,
        title: "Progressive Overload: The Key to Consistent Gains",
        excerpt: "Discover how to properly apply progressive overload to break through plateaus.",
        date: "2024-03-28",
        icon: "💪",
        slug: "progressive-overload"
    },
    {
        id: 3,
        title: "Recovery Strategies Beyond Sleep",
        excerpt: "Explore nutrition, active recovery, and lifestyle factors that accelerate muscle recovery.",
        date: "2024-03-20",
        icon: "😴",
        slug: "recovery-strategies"
    }
];

// Format date utility
function formatDate(dateString) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

// Get most recent post (for featured)
function getMostRecentPost() {
    return blogPosts.reduce((newest, post) => {
        return new Date(post.date) > new Date(newest.date) ? post : newest;
    });
}

// Render blog grid on homepage
function renderBlogGrid() {
    const blogGrid = document.getElementById('blog-grid');
    if (!blogGrid) return;

    const recentPost = getMostRecentPost();

    const html = blogPosts.map(post => {
        const isFeatured = post.id === recentPost.id;
        return `
            <div class="blog-card ${isFeatured ? 'featured' : ''}" onclick="viewPost('${post.slug}')">
                <div class="blog-card-image">${post.icon}</div>
                <div class="blog-card-content">
                    <div class="blog-card-date">
                        <i class="fas fa-calendar"></i> ${formatDate(post.date)}
                    </div>
                    <h3>${post.title}</h3>
                    <p>${post.excerpt}</p>
                    <a href="blog/${post.slug}.html" class="read-more">
                        Read More <i class="fas fa-arrow-right"></i>
                    </a>
                </div>
            </div>
        `;
    }).join('');

    blogGrid.innerHTML = html;
}

// Navigate to post
function viewPost(slug) {
    window.location.href = `blog/${slug}.html`;
}

// Mobile menu toggle
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

hamburger?.addEventListener('click', () => {
    navMenu?.classList.toggle('active');
    hamburger.classList.toggle('active');
});

// Close menu when a link is clicked
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        navMenu?.classList.remove('active');
        hamburger?.classList.remove('active');
    });
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && document.querySelector(href)) {
            e.preventDefault();
            document.querySelector(href)?.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// Initialize blog grid when page loads
document.addEventListener('DOMContentLoaded', renderBlogGrid);
