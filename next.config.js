/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ignore typescript errors during build to save resources in development
  typescript: {
    ignoreBuildErrors: true,
  },

  // Required for Cloud Workstations / Firebase Studio security
  allowedDevOrigins: [
    '6000-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
    '9000-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
    '9002-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
    'localhost:3000',
    '*.cloudworkstations.dev'
  ],

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos', pathname: '/**' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com', pathname: '/**' },
      { protocol: 'https', hostname: 'placehold.co', pathname: '/**' }
    ],
  },

  experimental: {
    serverActions: {
      allowedOrigins: [
        '6000-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
        '9000-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
        '9002-firebase-studio-1751357598651.cluster-bg6uurscprhn6qxr6xwtrhvkf6.cloudworkstations.dev',
        'localhost:3000',
        '*.cloudworkstations.dev'
      ]
    }
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-Requested-With, Content-Type, Authorization" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
