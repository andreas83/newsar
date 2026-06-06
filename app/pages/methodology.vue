<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-16 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            Our Methodology
          </h1>
          <p class="text-xl text-ink-3">
            How we collect, classify, and analyze news from multiple perspectives
          </p>
        </div>
      </Container>
    </section>

    <!-- Content -->
    <section class="py-16">
      <Container>
        <div class="max-w-4xl mx-auto prose prose-gray dark:prose-invert prose-lg">

          <!-- Pipeline Overview -->
          <h2>Processing Pipeline</h2>
          <p>
            Every article passes through a six-stage pipeline before it reaches you. Each stage
            runs automatically and can process thousands of articles per day.
          </p>
          <ol>
            <li><strong>Collection</strong> &mdash; RSS feeds are polled and new articles are deduplicated via SHA-256 content hashing</li>
            <li><strong>Extraction</strong> &mdash; Full article text is retrieved using Mozilla Readability, stripping ads and boilerplate</li>
            <li><strong>Classification</strong> &mdash; Language, political bias, entities, and sentiment are determined</li>
            <li><strong>Embedding</strong> &mdash; Articles are converted to 768-dimensional vectors for semantic search</li>
            <li><strong>Analysis</strong> &mdash; Keywords, summaries (short, medium, long), and sentiment scores are generated</li>
            <li><strong>Clustering</strong> &mdash; Similar articles are grouped into multi-perspective "stories"</li>
          </ol>

          <!-- Data Collection -->
          <h2>Data Collection</h2>
          <p>
            Newsar aggregates news from RSS feeds across the political spectrum. We carefully select sources
            to ensure balanced coverage from left-leaning, centrist, and right-leaning outlets.
          </p>

          <h3>Feed Selection Criteria</h3>
          <ul>
            <li>Established news organizations with consistent publishing schedules</li>
            <li>Diverse political perspectives to avoid echo chambers</li>
            <li>Regional variety to capture different geographic viewpoints</li>
            <li>Multiple languages to provide international coverage</li>
          </ul>

          <!-- Classification -->
          <h2>Classification System</h2>
          <p>
            Every article is automatically classified using a hybrid approach that combines rule-based
            methods with AI-powered analysis.
          </p>

          <h3>Political Bias Scale</h3>
          <p>
            We use a continuous scale from -1.0 (far left) to +1.0 (far right), with 0 representing
            center/neutral coverage:
          </p>
          <ul>
            <li><strong>Far Left:</strong> -1.0 to -0.6</li>
            <li><strong>Center-Left:</strong> -0.6 to -0.2</li>
            <li><strong>Center:</strong> -0.2 to +0.2</li>
            <li><strong>Center-Right:</strong> +0.2 to +0.6</li>
            <li><strong>Far Right:</strong> +0.6 to +1.0</li>
          </ul>

          <h3>Classification Methods</h3>

          <h4>1. Rule-Based Classification</h4>
          <p>
            For sources with established bias ratings (e.g., from Media Bias/Fact Check), we apply
            known bias scores directly. This provides fast, consistent classification for major outlets.
          </p>

          <h4>2. AI-Powered Analysis</h4>
          <p>
            For unknown sources or verification, we use a 14-billion parameter language model
            (qwen2.5:14b) running on dedicated GPU infrastructure to analyze:
          </p>
          <ul>
            <li><strong>Language Detection:</strong> Automatic identification of article language</li>
            <li><strong>Political Bias:</strong> Content-based bias analysis using LLM reasoning</li>
            <li><strong>Geographic POV:</strong> Identifying regional perspective in coverage</li>
            <li><strong>Named Entities:</strong> Extracting people, organizations, locations, and events</li>
            <li><strong>Sentiment:</strong> Overall tone and emotional content analysis</li>
          </ul>

          <!-- Entity System -->
          <h2>Entity Intelligence</h2>
          <p>
            Newsar maintains a knowledge base of over 56,000 named entities extracted from articles.
            Entities are categorized into four types:
          </p>
          <ul>
            <li><strong>People</strong> &mdash; Politicians, business leaders, public figures</li>
            <li><strong>Organizations</strong> &mdash; Companies, governments, NGOs, political parties</li>
            <li><strong>Locations</strong> &mdash; Countries, cities, regions involved in the news</li>
            <li><strong>Events</strong> &mdash; Elections, conflicts, summits, disasters</li>
          </ul>

          <h3>Entity Summaries</h3>
          <p>
            Top trending entities receive AI-generated summaries that are periodically refreshed.
            Each summary includes a short description, a detailed overview, and trending scores
            based on recent mention velocity.
          </p>

          <h3>Entity Network Graph</h3>
          <p>
            Co-occurrence analysis reveals relationships between entities. When two entities are
            frequently mentioned together across different articles, a connection is established.
            These relationships are visualized as interactive network graphs on entity detail pages,
            helping you discover non-obvious connections between people, organizations, and events.
          </p>

          <!-- Story Clustering -->
          <h2>Story Clustering</h2>
          <p>
            Articles covering the same news event are automatically grouped into "stories" using semantic
            similarity analysis.
          </p>

          <h3>How It Works</h3>
          <ol>
            <li>
              <strong>Embedding Generation:</strong> Each article is converted into a 768-dimensional
              vector using the nomic-embed-text model
            </li>
            <li>
              <strong>Similarity Search:</strong> We use pgvector's cosine similarity to find related articles
            </li>
            <li>
              <strong>Clustering:</strong> A DBSCAN-based algorithm groups articles that exceed a similarity
              threshold (typically 0.75) into clusters
            </li>
            <li>
              <strong>Story Creation:</strong> Each cluster becomes a "story" with articles from different perspectives
            </li>
          </ol>

          <h3>Story Trending</h3>
          <p>
            Stories receive dynamic trending scores that reflect how actively they are being covered:
          </p>
          <ul>
            <li><strong>Article velocity:</strong> How many new articles per hour are being published</li>
            <li><strong>Recency:</strong> Scores decay over 48 hours unless new coverage arrives</li>
            <li><strong>Source diversity:</strong> Stories covered by more unique sources rank higher</li>
          </ul>

          <h3>Coverage Diversity Score</h3>
          <p>
            Stories receive a diversity score (0&ndash;1) based on:
          </p>
          <ul>
            <li>Number of unique sources covering the story</li>
            <li>Distribution across political bias categories (left, center, right)</li>
            <li>Geographic diversity of sources</li>
            <li>Time span of coverage</li>
          </ul>

          <!-- Content Analysis -->
          <h2>Content Analysis</h2>
          <p>
            Beyond classification, we perform additional analysis to help you understand each article:
          </p>

          <h3>Keyword Extraction</h3>
          <p>
            AI-powered identification of the most important terms and concepts in each article,
            with relevance scoring and category labels.
          </p>

          <h3>Summary Generation</h3>
          <p>
            Each article receives three levels of summary&mdash;short, medium, and long&mdash;created
            by AI to help you quickly understand the article's main points at whatever depth you need.
          </p>

          <h3>Sentiment Analysis</h3>
          <p>
            Overall tone assessment on a scale from very negative (-1.0) to very positive (+1.0),
            helping you understand the emotional framing of the coverage.
          </p>

          <!-- Quality -->
          <h2>Quality &amp; Transparency</h2>

          <h3>Confidence Scores</h3>
          <p>
            Every classification includes a confidence score (0&ndash;1) indicating how certain the AI is
            about its assessment. Lower confidence suggests the article may have mixed signals or
            be difficult to classify.
          </p>

          <h3>Method Indicators</h3>
          <p>
            Each article shows whether it was classified using:
          </p>
          <ul>
            <li><strong>Rule-based:</strong> Known source with established rating</li>
            <li><strong>AI-analyzed:</strong> Content-based analysis for unknown sources</li>
            <li><strong>Hybrid:</strong> Combination of both methods</li>
          </ul>

          <h3>Continuous Improvement</h3>
          <p>
            Our classification system is constantly being refined. We:
          </p>
          <ul>
            <li>Monitor classification accuracy across sources</li>
            <li>Update source ratings as outlets evolve</li>
            <li>Improve AI prompts based on performance</li>
            <li>Add new sources to maintain balanced coverage</li>
          </ul>

          <!-- Infrastructure -->
          <h2>Infrastructure</h2>
          <p>
            All AI inference runs on dedicated GPU infrastructure managed via an on-demand cloud system.
            GPU pods are created automatically when processing jobs are queued and terminated after
            idle periods to optimize costs. No user data or reading habits are sent to third-party
            AI services&mdash;only raw article content is processed.
          </p>
          <p>
            The full technology stack includes:
          </p>
          <ul>
            <li><strong>Nuxt 4</strong> for the web application</li>
            <li><strong>PostgreSQL + pgvector</strong> for storage and semantic search</li>
            <li><strong>Ollama</strong> serving qwen2.5:14b (chat) and nomic-embed-text (embeddings)</li>
            <li><strong>BullMQ + Redis</strong> for job queuing and worker orchestration</li>
          </ul>

          <!-- Limitations -->
          <h2>Limitations &amp; Biases</h2>
          <p>
            While we strive for accuracy and fairness, it's important to acknowledge limitations:
          </p>
          <ul>
            <li>AI models can make mistakes or misinterpret nuanced content</li>
            <li>The left-right political spectrum is simplistic and doesn't capture all viewpoints</li>
            <li>Source selection inherently involves editorial decisions</li>
            <li>Breaking news may not be immediately classified or clustered</li>
            <li>Entity extraction can produce duplicates or miss contextual nuance</li>
          </ul>

          <p>
            We encourage critical thinking and using Newsar as one of many tools for staying informed.
          </p>

          <div class="not-prose mt-12 text-center">
            <p class="text-ink-3 mb-6">
              Have questions about our methodology or suggestions for improvement?
            </p>
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
