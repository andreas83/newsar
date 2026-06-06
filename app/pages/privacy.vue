<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-16 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            Privacy Policy
          </h1>
          <p class="text-xl text-ink-3">
            Your privacy matters. Here's how we protect it.
          </p>
        </div>
      </Container>
    </section>

    <!-- Content -->
    <section class="py-16">
      <Container>
        <div class="max-w-4xl mx-auto prose prose-gray dark:prose-invert prose-lg">
          <p class="lead">
            Newsar is designed with privacy as a core principle. This policy explains what data we collect,
            how we use it, and your rights regarding your information.
          </p>

          <h2>What We Collect</h2>

          <h3>News Articles</h3>
          <p>
            We collect publicly available news articles from RSS feeds to provide our news aggregation service.
            This data includes article titles, content, URLs, publication dates, and author information.
          </p>

          <h3>No Personal Data</h3>
          <p>
            Newsar does not collect, store, or track:
          </p>
          <ul>
            <li>Personal identification information</li>
            <li>Email addresses or contact information</li>
            <li>Reading history or browsing behavior</li>
            <li>IP addresses or device information</li>
            <li>Cookies or tracking pixels</li>
            <li>Location data</li>
          </ul>

          <h2>How We Process Data</h2>

          <h3>AI Processing via Google Gemini</h3>
          <p>
            Article classification, entity extraction, and analysis are performed using the Google Gemini API.
            This means article text (titles, content, and metadata) is sent to Google's servers for processing.
            No personal user data is included in these requests — only publicly available news content.
          </p>
          <p>
            Google's use of this data is governed by their
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener">Gemini API Terms of Service</a>.
            Under their API terms, data sent via the paid API is not used to train Google's models.
          </p>

          <h3>What We Don't Use</h3>
          <p>
            We don't use:
          </p>
          <ul>
            <li>Google Analytics or similar tracking services</li>
            <li>Third-party advertising networks</li>
            <li>Social media tracking pixels</li>
            <li>Content delivery networks that track users</li>
          </ul>

          <h2>Data Storage</h2>

          <h3>Where Your Data Lives</h3>
          <p>
            All data is stored in a local PostgreSQL database. When self-hosted, you have complete control
            over where your data resides and who can access it.
          </p>

          <h3>What We Store</h3>
          <ul>
            <li>RSS feed configurations</li>
            <li>Downloaded article content and metadata</li>
            <li>AI-generated classifications and analysis</li>
            <li>Vector embeddings for similarity search</li>
            <li>Aggregated statistics (article counts, trends)</li>
          </ul>

          <h2>Third-Party Content</h2>

          <h3>Original Article Links</h3>
          <p>
            When you click "Read Original Article" or similar links, you'll be directed to the original
            publisher's website. Their privacy policies and tracking practices apply once you leave Newsar.
          </p>

          <h3>RSS Feeds</h3>
          <p>
            We fetch public RSS feeds from news sources. This is equivalent to using a traditional RSS reader
            and doesn't expose your personal information to the source websites.
          </p>

          <h2>Your Rights</h2>

          <h3>Self-Hosting</h3>
          <p>
            Newsar is designed to be self-hosted, giving you complete control over your instance and data.
            You can:
          </p>
          <ul>
            <li>Run Newsar on your own server or computer</li>
            <li>Control which feeds to follow</li>
            <li>Access and export all data</li>
            <li>Delete any or all data at any time</li>
            <li>Modify the source code to suit your needs</li>
          </ul>

          <h2>Open Source Transparency</h2>
          <p>
            Newsar's source code is available for inspection. You can verify that we follow privacy-first
            principles by reviewing the code yourself or having an expert do so.
          </p>

          <h2>Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. Any changes will be reflected in the
            "Last Updated" date below. Since Newsar doesn't collect user contact information, we cannot
            notify you of changes directly.
          </p>

          <h2>Contact</h2>
          <p>
            If you have questions about this privacy policy or Newsar's privacy practices, please refer
            to the project documentation or open an issue on the GitHub repository.
          </p>

          <div class="not-prose mt-12 p-6 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded">
            <h3 class="text-xl font-bold text-green-900 dark:text-green-300 mb-2">Privacy First</h3>
            <p class="text-green-800 dark:text-green-400">
              Newsar will never sell your data, track your reading habits, or compromise your privacy.
              Self-hosting ensures you maintain complete control over your news consumption.
            </p>
          </div>

          <p class="text-sm text-ink-3 mt-12">
            <strong>Last Updated:</strong> May 2, 2026
          </p>

          <div class="not-prose mt-8 text-center">
            <Button
              to="/about"
              color="primary"
              size="lg"
            >
              Learn More About Newsar
            </Button>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>
