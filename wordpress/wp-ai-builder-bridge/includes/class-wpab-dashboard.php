<?php
/**
 * ESCANOR — Dashboard (the base Chat + Content module and home/launchpad).
 *
 * This is the plugin's landing page and, at the same time, the first product
 * module: Chat + Content. It is a *native* wp-admin screen — it respects the
 * administrator's admin colour scheme and sits inside the standard `.wrap`
 * chrome — deliberately distinct from the full-screen dark Studio (WPAB_Editor).
 *
 * It writes no backend of its own. Every panel here reuses REST routes that
 * already exist:
 *
 *   /cloud/session          connection handshake + project name
 *   /editor/chat            the unified chat agent
 *   /editor/steps           live tool-step polling for a chat run
 *   /editor/content/types   native content inventory
 *   /editor/content/list    items of one type
 *
 * The heavier review flows (Build proposals, diffs, deploy, rollback, SEO /
 * Insights / Recommendations) stay in the Studio. When a chat turn produces a
 * change that needs review, the dashboard hands off to the Studio rather than
 * reimplementing the apply pipeline.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WPAB_Dashboard {

	private const NAMESPACE = WPAB_REST_NAMESPACE;

	public static function init(): void {
		// Nothing to register here directly — WPAB_Admin owns the top-level menu
		// and points its landing slug at self::render(). Kept for symmetry with
		// the other modules and as a home for future hooks.
	}

	/**
	 * The launchpad's module cards, one per entitlement key. `home` says where
	 * the module lives today: 'chat' is this Dashboard, 'studio' is the
	 * full-screen editor, 'soon' is not built yet. The enabled/locked state is
	 * resolved at render time from WPAB_Modules so licensing flips a card
	 * without touching this data.
	 */
	private static function modules(): array {
		return array(
			array(
				'key'   => 'content',
				'icon'  => 'dashicons-edit-page',
				'title' => 'Content',
				'desc'  => 'Chat with the AI and create or edit pages, posts and products in plain language.',
				'home'  => 'chat',
			),
			array(
				'key'   => 'seo',
				'icon'  => 'dashicons-search',
				'title' => 'SEO',
				'desc'  => 'Titles, meta descriptions and heading signals — written into your SEO plugin.',
				'home'  => 'dashboard',
			),
			array(
				'key'   => 'health',
				'icon'  => 'dashicons-heart',
				'title' => 'Health',
				'desc'  => 'Checks across the site with one-click fixes the AI can apply and roll back.',
				'home'  => 'soon',
			),
			array(
				'key'   => 'build',
				'icon'  => 'dashicons-hammer',
				'title' => 'Build',
				'desc'  => 'Generate a custom theme, sections, pages and features — then refine with AI.',
				'home'  => 'build',
			),
		);
	}

	/* Sub-page callbacks — each is its own wp-admin screen under ESCANOR. */
	public static function render_content(): void {
		self::render( 'content' );
	}
	public static function render_seo(): void {
		self::render( 'seo' );
	}
	public static function render_insights(): void {
		self::render( 'insights' );
	}
	public static function render_build(): void {
		self::render( 'build' );
	}

	public static function render( string $view = 'home' ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$connected = WPAB_Cloud::has_key();
		$project   = WPAB_Cloud::cached_project();
		$studio    = admin_url( 'admin.php?page=wp-ai-builder-editor' );
		$cloud     = admin_url( 'admin.php?page=wp-ai-builder-cloud' );

		$content_url  = admin_url( 'admin.php?page=wp-ai-builder-content' );
		$seo_url      = admin_url( 'admin.php?page=wp-ai-builder-seo' );
		$insights_url = admin_url( 'admin.php?page=wp-ai-builder-insights' );
		$build_url    = admin_url( 'admin.php?page=wp-ai-builder-build' );

		$project_name = isset( $project['name'] ) ? (string) $project['name'] : '';
		$modules      = WPAB_Modules::all();
		$plan         = WPAB_Modules::plan();

		$subs = array(
			'home'      => 'Chat &amp; Content — your home for building this site with AI.',
			'content'   => 'Chat with the AI and create or edit pages, posts and products.',
			'seo'       => 'Optimize titles, meta and keyphrases — written into your SEO plugin.',
			'insights'  => 'What the AI understands about this site.',
			'build'     => 'Generate a custom theme for this site, then refine everything with AI.',
		);
		$subtitle = isset( $subs[ $view ] ) ? $subs[ $view ] : $subs['home'];

		$config = array(
			'restSession'      => esc_url_raw( rest_url( self::NAMESPACE . '/cloud/session' ) ),
			'restChat'         => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/chat' ) ),
			'restSteps'        => esc_url_raw( rest_url( self::NAMESPACE . '/editor/steps' ) ),
			'restContentTypes' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/types' ) ),
			'restContentList'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/list' ) ),
			'restContentGet'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/get' ) ),
			'restContentCreate' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/create' ) ),
			'restContentPropose' => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/propose' ) ),
			'restContentApply'   => esc_url_raw( rest_url( self::NAMESPACE . '/editor/content/apply' ) ),
			'restSeoGet'        => esc_url_raw( rest_url( self::NAMESPACE . '/editor/seo/get' ) ),
			'restSeoPropose'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/seo/propose' ) ),
			'restSeoApply'      => esc_url_raw( rest_url( self::NAMESPACE . '/editor/seo/apply' ) ),
			'restSeoAudit'      => esc_url_raw( rest_url( self::NAMESPACE . '/editor/seo/audit' ) ),
			'restSeoSite'       => esc_url_raw( rest_url( self::NAMESPACE . '/editor/seo/site' ) ),
			'restAnalyze'       => esc_url_raw( rest_url( self::NAMESPACE . '/editor/analyze' ) ),
			'restUnderstand'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/understand' ) ),
			'restBuildTheme'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/create-theme' ) ),
			'restBuildSite'     => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/generate-site' ) ),
			'restBuildImage'    => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/image' ) ),
			'restBuildGallery'  => esc_url_raw( rest_url( self::NAMESPACE . '/editor/build/gallery' ) ),
			'seoEnabled'        => ! empty( $modules['seo'] ),
			'nonce'            => wp_create_nonce( 'wp_rest' ),
			'studioUrl'        => esc_url_raw( $studio ),
			'cloudUrl'         => esc_url_raw( $cloud ),
			'connected'        => $connected,
		);
		?>
		<div class="wrap wpab-dash" id="wpab-dash">

			<div class="wpab-dash__top">
				<div class="wpab-dash__brand">
					<span class="dashicons dashicons-superhero wpab-dash__logo"></span>
					<div>
						<h1 class="wpab-dash__title">ESCANOR AI Builder</h1>
						<p class="wpab-dash__sub"><?php echo wp_kses( $subtitle, array() ); ?></p>
					</div>
				</div>
				<div class="wpab-dash__topactions">
					<?php if ( $connected ) : ?>
						<span class="wpab-dash__plan" title="Your current plan">Plan: <strong><?php echo esc_html( ucfirst( $plan ) ); ?></strong></span>
					<?php endif; ?>
					<span id="wpab-dash-status" class="wpab-dash__status wpab-dash__status--<?php echo $connected ? 'wait' : 'off'; ?>">
						<?php echo $connected ? 'Checking connection…' : 'Not connected'; ?>
					</span>
					<a class="button button-primary button-hero wpab-dash__studio" href="<?php echo esc_url( $studio ); ?>">
						<span class="dashicons dashicons-external"></span> Open Studio
					</a>
				</div>
			</div>

			<?php if ( ! $connected ) : ?>
				<div class="wpab-dash__connect notice notice-warning" style="margin:0 0 20px;padding:16px">
					<p style="margin:0 0 6px"><strong>This site is not connected to the AI Builder yet.</strong></p>
					<p style="margin:0 0 12px" class="description">
						Chat and content tools need a site key from your project in the ESCANOR cloud.
						Paste one on the Cloud connection screen to switch everything on.
					</p>
					<a class="button button-primary" href="<?php echo esc_url( $cloud ); ?>">Connect this site</a>
				</div>
			<?php endif; ?>

			<?php if ( 'home' === $view ) : ?>
			<div class="wpab-dash__modules">
				<?php
				foreach ( self::modules() as $m ) :
					$enabled = ! empty( $modules[ $m['key'] ] );
					$is_base = 'content' === $m['key'];

					if ( ! $enabled ) {
						$card_class  = 'is-locked';
						$badge       = '&#128274; Locked';
					} elseif ( $is_base || 'dashboard' === $m['home'] || 'build' === $m['home'] ) {
						$card_class  = 'is-active';
						$badge       = 'Active';
					} elseif ( 'studio' === $m['home'] ) {
						$card_class  = 'is-studio';
						$badge       = 'In Studio';
					} else {
						$card_class  = 'is-soon';
						$badge       = 'Coming soon';
					}
					?>
					<div class="wpab-card <?php echo esc_attr( $card_class ); ?>" data-module="<?php echo esc_attr( $m['key'] ); ?>">
						<div class="wpab-card__head">
							<span class="dashicons <?php echo esc_attr( $m['icon'] ); ?>"></span>
							<span class="wpab-card__badge"><?php echo wp_kses( $badge, array() ); ?></span>
						</div>
						<h3 class="wpab-card__title"><?php echo esc_html( $m['title'] ); ?></h3>
						<p class="wpab-card__desc"><?php echo esc_html( $m['desc'] ); ?></p>
						<?php if ( ! $enabled ) : ?>
							<button type="button" class="button wpab-card__btn" disabled>Locked on your plan</button>
						<?php elseif ( 'chat' === $m['home'] ) : ?>
							<a class="button button-primary wpab-card__btn" href="<?php echo esc_url( $content_url ); ?>">Open Content</a>
						<?php elseif ( 'dashboard' === $m['home'] ) : ?>
							<a class="button button-primary wpab-card__btn" href="<?php echo esc_url( $seo_url ); ?>">Open SEO</a>
						<?php elseif ( 'build' === $m['home'] ) : ?>
							<a class="button button-primary wpab-card__btn" href="<?php echo esc_url( $build_url ); ?>">Open Build</a>
						<?php elseif ( 'studio' === $m['home'] ) : ?>
							<a class="button wpab-card__btn" href="<?php echo esc_url( $studio ); ?>">Open in Studio</a>
						<?php else : ?>
							<button type="button" class="button wpab-card__btn" disabled>Coming soon</button>
						<?php endif; ?>
					</div>
				<?php endforeach; ?>
			</div>


				<div class="wpab-panel" id="wpab-dash-glance" style="margin-top:4px">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-chart-bar"></span> Site at a glance</h2>
						<a class="wpab-linkbtn" href="<?php echo esc_url( $insights_url ); ?>">AI Insights &rarr;</a>
					</div>
					<div class="wpab-glance" id="wpab-glance-body"><p class="wpab-chat__empty"><?php echo $connected ? 'Loading…' : 'Connect this site to see your content.'; ?></p></div>
				</div>
<?php endif; ?>

			<?php if ( 'content' === $view ) : ?>
			<div class="wpab-dash__grid">

				<div class="wpab-panel wpab-panel--chat" id="wpab-dash-chat">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-format-chat"></span> Chat</h2>
						<button type="button" class="wpab-linkbtn" id="wpab-dash-newchat">New chat</button>
					</div>
					<div class="wpab-chat__thread" id="wpab-dash-thread" aria-live="polite">
						<p class="wpab-chat__empty">Ask about your content, create something new, or edit a page. For example: &ldquo;What pages do I have?&rdquo;, &ldquo;Create an FAQ page about shipping and returns&rdquo;, or &ldquo;Rewrite the About page intro to be warmer.&rdquo;</p>
					</div>
					<div class="wpab-picker" id="wpab-dash-picker">
						<span class="wpab-picker__label">Work on:</span>
						<select id="wpab-pick-type" class="wpab-picker__sel" aria-label="Content type"><option value="">type…</option></select>
						<select id="wpab-pick-item" class="wpab-picker__sel" aria-label="Item" disabled><option value="">pick an item…</option></select>
						<span id="wpab-pick-actions" class="wpab-picker__actions" hidden>
							<button type="button" class="wpab-picker__btn" id="wpab-pick-edit">Edit with AI</button>
							<a class="wpab-picker__btn" id="wpab-pick-open" target="_blank" rel="noopener">Open in WP</a>
						</span>
					</div>
					<form class="wpab-chat__form" id="wpab-dash-form">
						<textarea id="wpab-dash-input" class="wpab-chat__input" rows="2" placeholder="Message the AI…" <?php echo $connected ? '' : 'disabled'; ?>></textarea>
						<button type="submit" class="button button-primary wpab-chat__send" <?php echo $connected ? '' : 'disabled'; ?>>Send</button>
					</form>
					<p class="wpab-chat__meta" id="wpab-dash-meta"></p>
				</div>

				<div class="wpab-panel wpab-panel--content" id="wpab-dash-content">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-admin-page"></span> Recent content</h2>
						<button type="button" class="wpab-linkbtn" id="wpab-dash-content-refresh">Refresh</button>
					</div>
					<div class="wpab-ctabs" id="wpab-dash-ctabs"></div>
					<div class="wpab-clist" id="wpab-dash-clist">
						<p class="wpab-chat__empty"><?php echo $connected ? 'Loading content…' : 'Connect this site to browse its content.'; ?></p>
					</div>
				</div>

			</div>

			<?php endif; ?>

			<?php if ( 'seo' === $view && $connected ) : ?>
				<div class="wpab-panel wpab-panel--seo" id="wpab-dash-seo">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-search"></span> SEO optimizer</h2>
						<span id="wpab-seo-plugin" class="wpab-seo__plugin"></span>
					</div>
					<div id="wpab-seo-sitebar"></div>
					<div class="wpab-ctabs" id="wpab-seo-tabs"></div>
					<div class="wpab-seo__cols">
						<div class="wpab-seo__list" id="wpab-seo-items">
							<p class="wpab-chat__empty">Choose Pages, Posts or Products above, then click an item.</p>
						</div>
						<div id="wpab-seo-body" class="wpab-seo__body">
							<p class="wpab-chat__empty">Pick a page or post to see its current SEO and let the AI improve the title, meta description and focus keyphrase — written straight into your SEO plugin.</p>
						</div>
					</div>
				</div>
			<?php endif; ?>

			<?php if ( 'insights' === $view ) : ?>
				<div class="wpab-panel" id="wpab-dash-insights">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-chart-area"></span> AI Insights</h2>
						<button type="button" class="button button-primary" id="wpab-insights-run" <?php echo $connected ? '' : 'disabled'; ?>>Scan site with AI</button>
					</div>
					<div id="wpab-insights-body" class="wpab-seo__body">
						<p class="wpab-chat__empty">Click &ldquo;Scan site with AI&rdquo; for a plain-language read of what this site is, who it is for, the problem it solves, its objective, positioning and outlook.</p>
					</div>
				</div>
			<?php endif; ?>

			<?php if ( 'build' === $view ) : ?>
				<div class="wpab-panel" id="wpab-dash-build">
					<div class="wpab-panel__head">
						<h2 class="wpab-panel__title"><span class="dashicons dashicons-art"></span> Create your site</h2>
					</div>
					<?php if ( ! $connected ) : ?>
						<div class="wpab-build__body"><p class="wpab-chat__empty">Connect this site first to generate a theme.</p></div>
					<?php elseif ( empty( $modules['build'] ) ) : ?>
						<div class="wpab-build__body"><p class="wpab-chat__empty">The Build module is locked on your plan. Enable it under Modules &amp; plan to generate a custom theme.</p></div>
					<?php else : ?>
					<div class="wpab-build__body">
						<p class="wpab-build__intro">Answer a few questions and the AI generates a brand-new custom block theme for this site — its own colours, type and identity. Sections, pages, custom features and AI images come next. Everything stays fully editable in WordPress and via chat.</p>
						<div class="wpab-build__grid">
							<label class="wpab-build__field"><span>Site name</span><input type="text" id="wpab-b-brand" placeholder="e.g. Aurora Studio" maxlength="60" /></label>
							<label class="wpab-build__field"><span>Tagline</span><input type="text" id="wpab-b-tagline" placeholder="e.g. Design that moves people" maxlength="120" /></label>
							<label class="wpab-build__field"><span>Site type</span>
								<select id="wpab-b-type">
									<option value="business">Business</option>
									<option value="restaurant">Restaurant / café</option>
									<option value="booking">Bookings / services</option>
									<option value="portfolio">Portfolio</option>
									<option value="shop">Shop</option>
									<option value="landing">Landing page</option>
									<option value="blog">Blog</option>
								</select>
							</label>
							<label class="wpab-build__field"><span>Style</span>
								<select id="wpab-b-style">
									<option value="modern">Modern</option>
									<option value="minimal">Minimal</option>
									<option value="bold">Bold</option>
									<option value="elegant">Elegant</option>
									<option value="playful">Playful</option>
								</select>
							</label>
							<label class="wpab-build__field"><span>Primary colour</span>
								<span class="wpab-build__color"><input type="color" id="wpab-b-color" value="#3a5bff" /><input type="text" id="wpab-b-colorhex" value="#3a5bff" maxlength="7" /></span>
							</label>
							<label class="wpab-build__field"><span>Typography</span>
								<select id="wpab-b-font">
									<option value="sans">Modern sans</option>
									<option value="rounded">Friendly / rounded</option>
									<option value="serif">Classic serif</option>
									<option value="editorial">Editorial serif</option>
									<option value="mono">Technical / mono</option>
								</select>
							</label>
							<label class="wpab-build__field"><span>Base</span>
								<select id="wpab-b-base">
									<option value="light">Light</option>
									<option value="dark">Dark</option>
								</select>
							</label>
						</div>
						<div class="wpab-build__actions">
							<button type="button" class="button button-primary button-hero" id="wpab-b-generate">Generate my theme</button>
							<span class="wpab-build__note">Creates a new, activated block theme. Your current content is kept.</span>
						</div>
						<div id="wpab-build-result" class="wpab-build__result"></div>
					</div>
					<?php endif; ?>
				</div>
			<?php endif; ?>

			<script type="text/javascript">
			var WPAB_DASH = <?php echo wp_json_encode( $config ); ?>;
			</script>
			<?php self::print_styles(); ?>
			<?php self::print_script(); ?>
		</div>
		<?php
	}

	/* --------------------------------------------------------------------- */

	private static function print_styles(): void {
		?>
		<style>
		#wpab-dash { max-width: 1180px; }
		#wpab-dash .wpab-dash__top { display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap; margin:8px 0 20px; }
		#wpab-dash .wpab-dash__brand { display:flex; align-items:center; gap:14px; }
		#wpab-dash .wpab-dash__logo { font-size:38px; width:38px; height:38px; color:#2271b1; }
		#wpab-dash .wpab-dash__title { margin:0; padding:0; font-size:23px; line-height:1.2; }
		#wpab-dash .wpab-dash__sub { margin:2px 0 0; color:#646970; }
		#wpab-dash .wpab-dash__topactions { display:flex; align-items:center; gap:12px; }
		#wpab-dash .wpab-dash__studio .dashicons { vertical-align:middle; margin-top:-2px; }
		#wpab-dash .wpab-dash__status { display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; padding:6px 12px; border-radius:999px; }
		#wpab-dash .wpab-dash__status::before { content:""; width:8px; height:8px; border-radius:50%; background:currentColor; }
		#wpab-dash .wpab-dash__status--on   { color:#00733f; background:#e6f5ec; }
		#wpab-dash .wpab-dash__status--wait { color:#8a6d00; background:#fbf3d6; }
		#wpab-dash .wpab-dash__status--off  { color:#8a1f11; background:#fbeaea; }
		#wpab-dash .wpab-dash__plan { font-size:12px; color:#646970; background:#f0f0f1; padding:6px 12px; border-radius:999px; }
		#wpab-dash .wpab-dash__plan strong { color:#1d2327; }

		#wpab-dash .wpab-dash__modules { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:0 0 24px; }
		@media (max-width:1100px){ #wpab-dash .wpab-dash__modules { grid-template-columns:repeat(2,1fr); } }
		@media (max-width:600px){ #wpab-dash .wpab-dash__modules { grid-template-columns:1fr; } }
		#wpab-dash .wpab-card { background:#fff; border:1px solid #dcdcde; border-radius:10px; padding:16px 16px 18px; display:flex; flex-direction:column; box-shadow:0 1px 2px rgba(0,0,0,.03); }
		#wpab-dash .wpab-card.is-active { border-color:#2271b1; box-shadow:0 0 0 1px #2271b1 inset, 0 1px 2px rgba(0,0,0,.04); }
		#wpab-dash .wpab-card__head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
		#wpab-dash .wpab-card__head .dashicons { font-size:26px; width:26px; height:26px; color:#2271b1; }
		#wpab-dash .wpab-card__badge { font-size:11px; font-weight:600; padding:2px 9px; border-radius:999px; background:#f0f0f1; color:#646970; }
		#wpab-dash .wpab-card.is-active .wpab-card__badge { background:#e6f5ec; color:#00733f; }
		#wpab-dash .wpab-card.is-soon .wpab-card__badge { background:#eef3fb; color:#2758a5; }
		#wpab-dash .wpab-card.is-locked { opacity:.72; background:#fafafa; }
		#wpab-dash .wpab-card.is-locked .wpab-card__head .dashicons { color:#a7aaad; }
		#wpab-dash .wpab-card.is-locked .wpab-card__badge { background:#f0f0f1; color:#8a1f11; }
		#wpab-dash .wpab-card__title { margin:0 0 4px; font-size:15px; }
		#wpab-dash .wpab-card__desc { margin:0 0 14px; color:#646970; font-size:13px; line-height:1.5; flex:1; }
		#wpab-dash .wpab-card__btn { align-self:flex-start; }

		#wpab-dash .wpab-dash__grid { display:grid; grid-template-columns:1.35fr 1fr; gap:20px; align-items:start; }
		@media (max-width:960px){ #wpab-dash .wpab-dash__grid { grid-template-columns:1fr; } }
		#wpab-dash .wpab-panel { background:#fff; border:1px solid #dcdcde; border-radius:10px; box-shadow:0 1px 2px rgba(0,0,0,.03); overflow:hidden; }
		#wpab-dash .wpab-panel__head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f0f0f1; }
		#wpab-dash .wpab-panel__title { margin:0; font-size:14px; display:flex; align-items:center; gap:7px; }
		#wpab-dash .wpab-panel__title .dashicons { color:#2271b1; font-size:19px; width:19px; height:19px; }
		#wpab-dash .wpab-linkbtn { background:none; border:none; color:#2271b1; cursor:pointer; font-size:13px; padding:2px 4px; }
		#wpab-dash .wpab-linkbtn:hover { color:#135e96; text-decoration:underline; }

		#wpab-dash .wpab-chat__thread { padding:16px; min-height:220px; max-height:440px; overflow-y:auto; }
		#wpab-dash .wpab-chat__empty { color:#8c8f94; font-size:13px; line-height:1.6; margin:0; }
		#wpab-dash .wpab-msg { margin:0 0 14px; }
		#wpab-dash .wpab-msg__role { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#8c8f94; margin-bottom:4px; }
		#wpab-dash .wpab-msg__body { font-size:14px; line-height:1.6; color:#1d2327; }
		#wpab-dash .wpab-msg--user .wpab-msg__body { background:#f0f6fc; border-radius:8px; padding:8px 12px; display:inline-block; }
		#wpab-dash .wpab-msg__body code { background:#f0f0f1; padding:1px 5px; border-radius:4px; font-size:12px; }
		#wpab-dash .wpab-msg__body ul { margin:6px 0 6px 18px; }
		#wpab-dash .wpab-msg__act { margin-top:6px; font-size:12px; color:#8c8f94; }
		#wpab-dash .wpab-msg__handoff { margin-top:10px; padding:10px 12px; background:#f6f7f7; border:1px solid #dcdcde; border-radius:8px; font-size:13px; }
		#wpab-dash .wpab-msg__handoff .button { margin-top:8px; }
		#wpab-dash .wpab-typing { font-size:13px; color:#8c8f94; }
		#wpab-dash .wpab-steps { margin-top:6px; }
		#wpab-dash .wpab-step { font-size:12px; color:#646970; padding:1px 0; }
		#wpab-dash .wpab-msg__act { margin-top:6px; font-size:12px; color:#8c8f94; }
		#wpab-dash .wpab-msg__act code { background:#f6f7f7; border:1px solid #f0f0f1; color:#646970; padding:1px 5px; border-radius:4px; margin-right:4px; font-size:11px; }

		#wpab-dash .wpab-ce { border:1px solid #dcdcde; border-radius:8px; padding:12px; margin-top:6px; background:#fbfbfc; }
		#wpab-dash .wpab-ce__head { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
		#wpab-dash .wpab-ce__pill { font-size:10px; text-transform:uppercase; letter-spacing:.03em; background:#eef3fb; color:#2758a5; padding:1px 7px; border-radius:999px; }
		#wpab-dash .wpab-ce__title { font-size:13px; font-weight:600; margin:0; }
		#wpab-dash .wpab-ce__meta { font-size:11px; color:#8c8f94; margin:0 0 8px; }
		#wpab-dash .wpab-ce-field { border-top:1px solid #f0f0f1; padding:8px 0; }
		#wpab-dash .wpab-ce-fname { font-size:11px; font-weight:700; text-transform:uppercase; color:#8c8f94; margin-bottom:3px; }
		#wpab-dash .wpab-ce-before { font-size:12px; color:#8a1f11; background:#fbeaea; border-radius:4px; padding:4px 7px; margin-bottom:3px; white-space:pre-wrap; word-break:break-word; }
		#wpab-dash .wpab-ce-after { font-size:12px; color:#00733f; background:#e6f5ec; border-radius:4px; padding:4px 7px; white-space:pre-wrap; word-break:break-word; }
		#wpab-dash .wpab-ce__actions { margin-top:10px; display:flex; gap:8px; align-items:center; }
		#wpab-dash .wpab-ce__status { font-size:12px; margin-top:8px; }

		#wpab-dash .wpab-picker { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 16px; border-top:1px solid #f0f0f1; background:#fafafa; }
		#wpab-dash .wpab-picker__label { font-size:12px; color:#646970; font-weight:600; }
		#wpab-dash .wpab-picker__sel { font-size:12px; padding:4px 8px; border:1px solid #dcdcde; border-radius:6px; background:#fff; max-width:220px; }
		#wpab-dash .wpab-picker__actions { display:inline-flex; gap:6px; }
		#wpab-dash .wpab-picker__btn { font-size:12px; padding:4px 10px; border:1px solid #2271b1; color:#2271b1; background:#fff; border-radius:6px; cursor:pointer; text-decoration:none; line-height:1.6; }
		#wpab-dash .wpab-picker__btn:hover { background:#f0f6fc; }

		#wpab-dash .wpab-seo__plugin { font-size:11px; color:#646970; background:#f0f0f1; padding:3px 10px; border-radius:999px; }
		#wpab-dash .wpab-seo__pick { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:12px 16px; border-bottom:1px solid #f0f0f1; background:#fafafa; }
		#wpab-dash .wpab-seo__cols { display:grid; grid-template-columns:260px 1fr; align-items:start; }
		@media (max-width:820px){ #wpab-dash .wpab-seo__cols { grid-template-columns:1fr; } }
		#wpab-dash .wpab-seo__list { border-right:1px solid #f0f0f1; max-height:560px; overflow-y:auto; padding:8px; }
		@media (max-width:820px){ #wpab-dash .wpab-seo__list { border-right:none; border-bottom:1px solid #f0f0f1; max-height:220px; } }
		#wpab-dash .wpab-seo__item { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:7px; cursor:pointer; }
		#wpab-dash .wpab-seo__item:hover { background:#f6f7f7; }
		#wpab-dash .wpab-seo__item.is-active { background:#f0f6fc; }
		#wpab-dash .wpab-seo__itemtitle { font-size:13px; color:#1d2327; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
		#wpab-dash .wpab-seo__summary { font-size:12px; color:#646970; padding:4px 10px 8px; }
		#wpab-dash .wpab-seo__summary strong { color:#1d2327; }
		#wpab-dash .wpab-seo__grade { font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap; }
		#wpab-dash .wpab-seo__grade--good { background:#e6f5ec; color:#00733f; }
		#wpab-dash .wpab-seo__grade--warn { background:#fbf3d6; color:#8a6d00; }
		#wpab-dash .wpab-seo__grade--bad { background:#fbeaea; color:#8a1f11; }
		#wpab-dash .wpab-seo__sitebar { padding:11px 16px; border-bottom:1px solid #f0f0f1; font-size:12px; color:#646970; display:flex; gap:14px; flex-wrap:wrap; align-items:center; }
		#wpab-dash .wpab-seo__sitebar a { color:#2271b1; text-decoration:none; }
		#wpab-dash .wpab-seo__hidden { background:#fbeaea; color:#8a1f11; padding:12px 16px; border-bottom:1px solid #f3c9c9; font-size:13px; }
		#wpab-dash .wpab-seo__hidden a { color:#8a1f11; font-weight:600; }
		#wpab-dash .wpab-seo__bulk { margin:0 10px 8px; }
		#wpab-dash .wpab-bulk-row { font-size:13px; padding:5px 0; border-top:1px solid #f0f0f1; }
		#wpab-dash .wpab-copybtn { background:none; border:1px solid #dcdcde; border-radius:5px; font-size:11px; padding:1px 7px; cursor:pointer; color:#2271b1; margin-left:6px; }
		#wpab-dash .wpab-copybtn:hover { background:#f0f6fc; }
		#wpab-dash .wpab-seo__body { padding:16px; }
		#wpab-dash .wpab-seo__optbar { margin-bottom:14px; }
		#wpab-dash .wpab-glance { padding:16px; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:12px; }
		#wpab-dash .wpab-glance__tile { border:1px solid #f0f0f1; border-radius:8px; padding:12px; text-align:center; background:#fafafa; }
		#wpab-dash .wpab-glance__num { font-size:22px; font-weight:600; color:#1d2327; }
		#wpab-dash .wpab-glance__label { font-size:12px; color:#646970; margin-top:2px; }
		#wpab-dash .wpab-build__body { padding:18px; }
		#wpab-dash .wpab-build__intro { color:#646970; font-size:13px; margin:0 0 16px; max-width:740px; line-height:1.6; }
		#wpab-dash .wpab-build__grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; max-width:820px; }
		@media (max-width:700px){ #wpab-dash .wpab-build__grid { grid-template-columns:1fr; } }
		#wpab-dash .wpab-build__field { display:flex; flex-direction:column; gap:5px; font-size:12px; color:#646970; font-weight:600; }
		#wpab-dash .wpab-build__field input[type=text], #wpab-dash .wpab-build__field select { font-size:13px; padding:7px 9px; border:1px solid #dcdcde; border-radius:7px; background:#fff; color:#1d2327; }
		#wpab-dash .wpab-build__color { display:flex; gap:8px; align-items:center; }
		#wpab-dash .wpab-build__color input[type=color] { width:42px; height:34px; padding:0; border:1px solid #dcdcde; border-radius:7px; background:#fff; cursor:pointer; }
		#wpab-dash .wpab-build__color input[type=text] { width:110px; }
		#wpab-dash .wpab-build__actions { margin-top:18px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
		#wpab-dash .wpab-build__note { font-size:12px; color:#8c8f94; }
		#wpab-dash .wpab-build__result { margin-top:16px; max-width:820px; }
		#wpab-dash .wpab-build__ok { background:#e6f5ec; border:1px solid #b7e0c6; border-radius:8px; padding:14px 16px; font-size:14px; color:#00733f; }
		#wpab-dash .wpab-build__err { color:#b32d2e; font-size:13px; }
		#wpab-dash .wpab-seo__field { border-top:1px solid #f0f0f1; padding:10px 0; }
		#wpab-dash .wpab-seo__field:first-child { border-top:none; }
		#wpab-dash .wpab-seo__fname { font-size:11px; font-weight:700; text-transform:uppercase; color:#8c8f94; margin-bottom:4px; display:flex; justify-content:space-between; }
		#wpab-dash .wpab-seo__len { font-weight:400; }
		#wpab-dash .wpab-seo__len--ok { color:#00733f; }
		#wpab-dash .wpab-seo__len--warn { color:#8a6d00; }
		#wpab-dash .wpab-seo__val { font-size:13px; color:#1d2327; background:#f6f7f7; border-radius:4px; padding:6px 9px; white-space:pre-wrap; word-break:break-word; }
		#wpab-dash .wpab-seo__val--empty { color:#a7aaad; font-style:italic; }
		#wpab-dash .wpab-seo__scores { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
		#wpab-dash .wpab-seo__score { font-size:12px; padding:5px 12px; border-radius:8px; }
		#wpab-dash .wpab-seo__score strong { font-size:14px; }
		#wpab-dash .wpab-seo__score--ok { background:#e6f5ec; color:#00733f; }
		#wpab-dash .wpab-seo__score--warn { background:#fbf3d6; color:#8a6d00; }
		#wpab-dash .wpab-seo__score--bad { background:#fbeaea; color:#8a1f11; }
		#wpab-dash .wpab-seo__stat { font-size:12px; padding:5px 12px; border-radius:8px; background:#f0f0f1; color:#646970; }
		#wpab-dash .wpab-seo__checks { margin-top:14px; border-top:1px solid #f0f0f1; padding-top:12px; }
		#wpab-dash .wpab-seo__ckhead { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#8c8f94; margin-bottom:8px; }
		#wpab-dash .wpab-seo__check { display:flex; gap:9px; padding:6px 0; align-items:flex-start; }
		#wpab-dash .wpab-seo__dot { width:9px; height:9px; border-radius:50%; margin-top:5px; flex-shrink:0; }
		#wpab-dash .wpab-seo__check--good .wpab-seo__dot { background:#00a32a; }
		#wpab-dash .wpab-seo__check--warn .wpab-seo__dot { background:#dba617; }
		#wpab-dash .wpab-seo__check--bad .wpab-seo__dot { background:#d63638; }
		#wpab-dash .wpab-seo__cklabel { font-size:13px; color:#1d2327; font-weight:500; }
		#wpab-dash .wpab-seo__ckhint { font-size:12px; color:#8c8f94; margin-top:1px; }
		#wpab-dash .wpab-chat__form { display:flex; gap:8px; padding:12px 16px; border-top:1px solid #f0f0f1; align-items:flex-end; }
		#wpab-dash .wpab-chat__input { flex:1; resize:vertical; min-height:40px; }
		#wpab-dash .wpab-chat__meta { padding:0 16px 12px; margin:0; font-size:12px; color:#8c8f94; min-height:14px; }

		#wpab-dash .wpab-ctabs { display:flex; flex-wrap:wrap; gap:6px; padding:12px 16px 0; }
		#wpab-dash .wpab-ctab { background:#f0f0f1; border:none; border-radius:999px; padding:4px 12px; font-size:12px; cursor:pointer; color:#3c434a; }
		#wpab-dash .wpab-ctab.is-active { background:#2271b1; color:#fff; }
		#wpab-dash .wpab-ctab__count { opacity:.7; margin-left:5px; }
		#wpab-dash .wpab-clist { padding:12px 16px 16px; max-height:520px; overflow-y:auto; }
		#wpab-dash .wpab-crow { padding:10px 0; border-bottom:1px solid #f0f0f1; }
		#wpab-dash .wpab-crow:last-child { border-bottom:none; }
		#wpab-dash .wpab-crow__top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
		#wpab-dash .wpab-crow__title { font-size:13px; font-weight:600; color:#1d2327; }
		#wpab-dash .wpab-cstatus { font-size:11px; color:#646970; background:#f0f0f1; padding:1px 8px; border-radius:999px; white-space:nowrap; }
		#wpab-dash .wpab-cstatus--publish { background:#e6f5ec; color:#00733f; }
		#wpab-dash .wpab-cstatus--draft { background:#fbf3d6; color:#8a6d00; }
		#wpab-dash .wpab-crow__actions { margin-top:6px; display:flex; gap:12px; }
		#wpab-dash .wpab-crow__actions a, #wpab-dash .wpab-crow__actions button { font-size:12px; color:#2271b1; background:none; border:none; padding:0; cursor:pointer; text-decoration:none; }
		#wpab-dash .wpab-crow__actions a:hover, #wpab-dash .wpab-crow__actions button:hover { text-decoration:underline; }
		</style>
		<?php
	}

	private static function print_script(): void {
		?>
		<script type="text/javascript">
		(function () {
			var cfg = WPAB_DASH || {};
			function $(id) { return document.getElementById(id); }
			function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }

			function api(method, url, body) {
				var opts = { method: method, headers: { 'X-WP-Nonce': cfg.nonce, 'Accept': 'application/json' }, credentials: 'same-origin' };
				if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
				return fetch(url, opts).then(function (r) {
					return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; })
						.catch(function () { return { ok: false, status: r.status, data: null }; });
				});
			}

			/* Minimal, safe markdown: escape first, then re-introduce a few marks. */
			function md(text) {
				var out = esc(text);
				out = out.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
				out = out.replace(/\*\*([^*]+)\*\*/g, function (_, b) { return '<strong>' + b + '</strong>'; });
				var lines = out.split(/\n/); var html = ''; var inList = false;
				for (var i = 0; i < lines.length; i++) {
					var ln = lines[i];
					if (/^\s*[-*]\s+/.test(ln)) {
						if (!inList) { html += '<ul>'; inList = true; }
						html += '<li>' + ln.replace(/^\s*[-*]\s+/, '') + '</li>';
					} else {
						if (inList) { html += '</ul>'; inList = false; }
						html += ln.trim() ? ('<div>' + ln + '</div>') : '<div style="height:6px"></div>';
					}
				}
				if (inList) { html += '</ul>'; }
				return html;
			}

			/* -------- Connection status -------- */
			(function checkStatus() {
				var el = $('wpab-dash-status');
				if (!el) { return; }
				if (!cfg.connected) { return; }
				api('POST', cfg.restSession, {}).then(function (out) {
					if (out.ok && out.data && !out.data.error && (out.data.project || out.data.ok !== false)) {
						var name = out.data.project && out.data.project.name ? out.data.project.name : '';
						el.className = 'wpab-dash__status wpab-dash__status--on';
						el.textContent = name ? ('Connected · ' + name) : 'Connected';
					} else {
						el.className = 'wpab-dash__status wpab-dash__status--off';
						el.textContent = 'Connection error';
					}
				}).catch(function () {
					el.className = 'wpab-dash__status wpab-dash__status--off';
					el.textContent = 'Connection error';
				});
			})();

			/* -------- Chat -------- */
			var thread = $('wpab-dash-thread');
			var form = $('wpab-dash-form');
			var input = $('wpab-dash-input');
			var metaEl = $('wpab-dash-meta');
			var newBtn = $('wpab-dash-newchat');
			var conversationId = null;
			var busy = false;

			function genRunId() { return 'dash-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

			function renderActivity(activity) {
				if (!activity || !activity.length) { return ''; }
				var parts = activity.map(function (item) {
					var label = (item.tool === 'get_content') ? 'read'
						: (item.tool === 'list_content_types') ? 'content types'
						: (item.tool === 'create_content') ? 'drafted'
						: (item.tool === 'request_content_edit') ? 'edit' : 'listed';
					var scope = item.scope ? esc(item.scope) : '';
					var paths = (item.paths && item.paths.length) ? ' ' + item.paths.map(esc).join(', ') : '';
					return '<code>' + label + ' ' + scope + paths + '</code>';
				});
				return '<div class="wpab-msg__act">Looked at ' + parts.join(' ') + '</div>';
			}
			function addMessage(role, body, activity) {
				var empty = thread.querySelector('.wpab-chat__empty');
				if (empty) { empty.remove(); }
				var wrap = document.createElement('div');
				wrap.className = 'wpab-msg wpab-msg--' + role;
				var bodyHtml = role === 'assistant' ? md(body) : esc(body);
				wrap.innerHTML = '<div class="wpab-msg__role">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="wpab-msg__body">' + bodyHtml + '</div>' + (role === 'assistant' ? renderActivity(activity) : '');
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function addTyping() {
				var wrap = document.createElement('div'); wrap.className = 'wpab-msg wpab-msg--assistant';
				wrap.innerHTML = '<div class="wpab-msg__role">AI</div><div class="wpab-typing">Working…</div><div class="wpab-steps"></div>';
				thread.appendChild(wrap); thread.scrollTop = thread.scrollHeight; return wrap;
			}
			function handoff(mount, label) {
				var box = document.createElement('div');
				box.className = 'wpab-msg__handoff';
				box.innerHTML = esc(label) + '<br><a class="button button-primary" href="' + esc(cfg.studioUrl) + '">Open in Studio to review &amp; apply</a>';
				mount.appendChild(box);
			}
			function createCard(mount, req) {
				var box = document.createElement('div');
				box.className = 'wpab-msg__handoff';
				var typeLabel = esc(req.type);
				box.innerHTML = 'Ready to create a new <strong>' + typeLabel + '</strong>: &ldquo;' + esc(req.title) + '&rdquo;.'
					+ '<br><button type="button" class="button button-primary wpab-create-pub">Create &amp; publish</button>'
					+ ' <button type="button" class="button wpab-create-go">Create draft</button>'
					+ ' <button type="button" class="button wpab-create-skip">Not now</button>'
					+ '<div class="wpab-create-status"></div>';
				mount.appendChild(box);
				var statusEl = box.querySelector('.wpab-create-status');
				var goBtn = box.querySelector('.wpab-create-go');
				var pubBtn = box.querySelector('.wpab-create-pub');
				var skipBtn = box.querySelector('.wpab-create-skip');
				skipBtn.addEventListener('click', function () { box.remove(); });
				function doCreate(status) {
					goBtn.disabled = true; pubBtn.disabled = true; skipBtn.disabled = true;
					statusEl.textContent = status === 'publish' ? 'Publishing…' : 'Creating draft…';
					api('POST', cfg.restContentCreate, {
						type: req.type, title: req.title, content: req.content || '', excerpt: req.excerpt || '', status: status
					}).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) {
							statusEl.innerHTML = '<span style="color:#b32d2e">' + esc((out.data && (out.data.message || out.data.error)) || 'Could not create the page.') + '</span>';
							goBtn.disabled = false; pubBtn.disabled = false; skipBtn.disabled = false;
							return;
						}
						var it = out.data;
						goBtn.remove(); pubBtn.remove(); skipBtn.remove();
						statusEl.innerHTML = '<span style="color:#00733f">&#10003; ' + (status === 'publish' ? 'Published' : 'Draft created') + '.</span> '
							+ (it.edit_url ? '<a class="button" href="' + esc(it.edit_url) + '" target="_blank" rel="noopener">Edit in WP</a> ' : '')
							+ (it.url ? '<a class="button" href="' + esc(it.url) + '" target="_blank" rel="noopener">View</a>' : '');
						loadTypes();
					}).catch(function () {
						statusEl.innerHTML = '<span style="color:#b32d2e">Network error creating the page.</span>';
						goBtn.disabled = false; pubBtn.disabled = false; skipBtn.disabled = false;
					});
				}
				goBtn.addEventListener('click', function () { doCreate('draft'); });
				pubBtn.addEventListener('click', function () { doCreate('publish'); });
			}
			/* ---- Inline content editing (propose → review → apply) ---- */
			function ceTrunc(t, nn) { t = String(t == null ? '' : t); return t.length > nn ? t.slice(0, nn) + '…' : t; }
			function renderContentEditCard(proposal, mount) {
				var changesHtml = (proposal.changes || []).map(function (c) {
					return '<div class="wpab-ce-field"><div class="wpab-ce-fname">' + esc(c.field) + '</div>' +
						(String(c.before) !== '' ? '<div class="wpab-ce-before">' + esc(ceTrunc(c.before, 1200)) + '</div>' : '') +
						'<div class="wpab-ce-after">' + esc(ceTrunc(c.after, 1200)) + '</div></div>';
				}).join('');
				mount.innerHTML = '<div class="wpab-ce"><div class="wpab-ce__head"><span class="wpab-ce__pill">edit</span><h4 class="wpab-ce__title">' + esc(proposal.summary || 'Content update') + '</h4></div>' +
					'<p class="wpab-ce__meta">' + esc((proposal.type || '') + ' · ' + esc(proposal.title || ('#' + proposal.id))) + '</p>' + changesHtml +
					'<div class="wpab-ce__actions"><button type="button" class="button button-primary wpab-ce-apply">Apply</button><button type="button" class="button wpab-ce-close">Dismiss</button></div><div class="wpab-ce__status"></div></div>';
				var card = mount.querySelector('.wpab-ce');
				card.querySelector('.wpab-ce-apply').addEventListener('click', function () { applyContentEdit(proposal, proposal.fields, card, false); });
				card.querySelector('.wpab-ce-close').addEventListener('click', function () { if (!busy) { mount.innerHTML = ''; } });
			}
			function applyContentEdit(proposal, fields, card, isUndo) {
				if (busy) { return; }
				setBusy(true);
				var slot = card.querySelector('.wpab-ce__status');
				if (slot) { slot.innerHTML = isUndo ? 'Undoing…' : 'Applying &amp; saving a revision…'; }
				api('POST', cfg.restContentApply, { type: proposal.type, id: proposal.id, fields: fields }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						var err = (out.data && (out.data.error || out.data.message)) || 'Update failed.';
						if (slot) { slot.innerHTML = '<span style="color:#b32d2e">' + esc(err) + '</span>'; }
						return;
					}
					var r = out.data.result || {};
					var rev = r.revision_id ? ' · revision ' + esc(String(r.revision_id)) : '';
					var view = r.url ? ' · <a href="' + esc(r.url) + '" target="_blank" rel="noopener">View</a>' : '';
					if (slot) {
						slot.innerHTML = '<span style="color:#00733f">' + (isUndo ? 'Reverted &#10003;' : 'Applied &#10003;') + '</span>' + rev + view;
						if (!isUndo && proposal.before) {
							var undoBtn = document.createElement('button'); undoBtn.type = 'button'; undoBtn.className = 'button'; undoBtn.textContent = 'Undo'; undoBtn.style.marginLeft = '8px';
							undoBtn.addEventListener('click', function () { applyContentEdit(proposal, proposal.before, card, true); });
							slot.appendChild(undoBtn);
						}
					}
					var ab = card.querySelector('.wpab-ce-apply'); if (ab) { ab.disabled = true; ab.textContent = isUndo ? 'Reverted' : 'Applied'; }
					loadTypes();
				}).catch(function () { if (slot) { slot.innerHTML = '<span style="color:#b32d2e">Network request failed.</span>'; } })
				.then(function () { setBusy(false); });
			}
			function startInlineContentEdit(mount, req) {
				var box = document.createElement('div');
				box.className = 'wpab-msg__handoff';
				box.innerHTML = '<span class="wpab-typing">Drafting the change to ' + esc(req.type) + ' #' + esc(req.id) + '…</span><div class="wpab-ce-mount"></div>';
				mount.appendChild(box);
				var statusEl = box.querySelector('.wpab-typing');
				var ceMount = box.querySelector('.wpab-ce-mount');
				setBusy(true);
				api('POST', cfg.restContentPropose, { type: req.type, id: req.id, instruction: req.instruction }).then(function (out) {
					if (statusEl) { statusEl.remove(); }
					if (!out.ok || !out.data || out.data.success === false) {
						ceMount.innerHTML = '<span style="color:#b32d2e">' + esc((out.data && (out.data.error || out.data.message)) || 'Could not draft the change.') + '</span>';
						return;
					}
					if (!out.data.proposal) { ceMount.innerHTML = esc(out.data.message || 'No change was needed.'); return; }
					renderContentEditCard(out.data.proposal, ceMount);
				}).catch(function () {
					if (statusEl) { statusEl.remove(); }
					ceMount.innerHTML = '<span style="color:#b32d2e">Network error. If the change was large it may still be processing — try again.</span>';
				}).then(function () { setBusy(false); thread.scrollTop = thread.scrollHeight; });
			}

			function setBusy(v) { busy = v; if (input) { input.disabled = v; } var b = form ? form.querySelector('button[type=submit]') : null; if (b) { b.disabled = v; } }
			function resetThread() {
				conversationId = null; metaEl.textContent = '';
				thread.innerHTML = '<p class="wpab-chat__empty">New chat. Ask about this site, or describe a change.</p>';
			}

			function sendChat(message) {
				setBusy(true); metaEl.textContent = '';
				var runId = genRunId();
				var typing = addTyping();
				var stepsBox = typing.querySelector('.wpab-steps');
				var polling = true;
				function pollSteps() {
					if (!polling) { return; }
					api('GET', cfg.restSteps + '?runId=' + encodeURIComponent(runId)).then(function (o) {
						if (!polling) { return; }
						var st = (o.data && o.data.steps) || [];
						if (st.length && stepsBox) { stepsBox.innerHTML = st.map(function (s) { return '<div class="wpab-step">' + esc(s.label) + '</div>'; }).join(''); }
						if (polling) { setTimeout(pollSteps, 1300); }
					}).catch(function () { if (polling) { setTimeout(pollSteps, 1500); } });
				}
				setTimeout(pollSteps, 700);
				var payload = { message: message, runId: runId };
				if (conversationId) { payload.conversationId = conversationId; }
				api('POST', cfg.restChat, payload).then(function (out) {
					polling = false; typing.remove();
					if (!out.ok || !out.data || out.data.success === false) {
						addMessage('assistant', 'Error: ' + ((out.data && (out.data.error || out.data.message)) || 'Request failed.'));
						return;
					}
					var d = out.data;
					if (d.conversation && d.conversation.id) { conversationId = d.conversation.id; }
					var msg = addMessage('assistant', d.answer || 'Done.', d.activity);
					if (d.contentCreateRequest && d.contentCreateRequest.title) { createCard(msg, d.contentCreateRequest); }
					else if (d.contentEditRequest && d.contentEditRequest.id) { startInlineContentEdit(msg, d.contentEditRequest); }
					else if (d.buildRequest && d.buildRequest.instruction) { handoff(msg, 'This change needs a review step (code diff & deploy) — open it in the Studio.'); }
					if (d.usage) { metaEl.textContent = (d.toolCalls || 0) + ' tool calls · ' + (d.usage.totalTokens || 0).toLocaleString() + ' tokens'; }
				}).catch(function () { polling = false; typing.remove(); addMessage('assistant', 'Error: network request failed.'); })
				.then(function () { setBusy(false); input.focus(); });
			}

			if (form) {
				form.addEventListener('submit', function (e) {
					e.preventDefault();
					if (busy || !cfg.connected) { return; }
					var m = input.value.trim();
					if (!m) { return; }
					addMessage('user', m); input.value = ''; sendChat(m);
				});
				input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
			}
			if (newBtn) { newBtn.addEventListener('click', function () { if (!busy) { resetThread(); input.focus(); } }); }

			/* Module card jumps: Content → chat, SEO → optimizer panel. */
			var jumpers = document.querySelectorAll('[data-jump]');
			for (var c = 0; c < jumpers.length; c++) {
				jumpers[c].addEventListener('click', function () {
					var target = this.getAttribute('data-jump');
					var panel = $(target === 'seo' ? 'wpab-dash-seo' : 'wpab-dash-chat');
					if (panel) { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
					if (target !== 'seo' && input && !input.disabled) { setTimeout(function () { input.focus(); }, 300); }
				});
			}

			/* Prefill chat from a content row's "Edit with AI". */
			function askAbout(prefix) {
				var panel = $('wpab-dash-chat');
				if (panel) { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
				if (input && !input.disabled) { input.value = prefix; setTimeout(function () { input.focus(); }, 300); }
			}

			/* -------- Recent content -------- */
			var tabsEl = $('wpab-dash-ctabs');
			var listEl = $('wpab-dash-clist');
			var refreshBtn = $('wpab-dash-content-refresh');
			var activeType = null;

			function loadTypes() {
				if (!cfg.connected || !tabsEl || !listEl) { return; }
				api('GET', cfg.restContentTypes).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { listEl.innerHTML = '<p class="wpab-chat__empty">Could not load content.</p>'; return; }
					var types = (out.data.types || []).filter(function (t) { return t.count > 0 || t.key === 'page' || t.key === 'post'; });
					if (!types.length) { listEl.innerHTML = '<p class="wpab-chat__empty">No content found.</p>'; return; }
					tabsEl.innerHTML = '';
					types.forEach(function (t) {
						var b = document.createElement('button'); b.type = 'button'; b.className = 'wpab-ctab'; b.setAttribute('data-type', t.key);
						b.innerHTML = esc(t.label) + '<span class="wpab-ctab__count">' + (t.count || 0) + '</span>';
						b.addEventListener('click', function () { selectType(t.key); });
						tabsEl.appendChild(b);
					});
					selectType(types[0].key);
				}).catch(function () { listEl.innerHTML = '<p class="wpab-chat__empty">Could not reach WordPress.</p>'; });
			}
			function selectType(type) {
				activeType = type;
				var btns = tabsEl.querySelectorAll('.wpab-ctab');
				for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle('is-active', btns[i].getAttribute('data-type') === type); }
				listEl.innerHTML = '<p class="wpab-chat__empty">Loading…</p>';
				api('GET', cfg.restContentList + '?type=' + encodeURIComponent(type) + '&limit=12').then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { listEl.innerHTML = '<p class="wpab-chat__empty">Could not load items.</p>'; return; }
					renderList(type, out.data.items || []);
				}).catch(function () { listEl.innerHTML = '<p class="wpab-chat__empty">Could not reach WordPress.</p>'; });
			}
			function renderList(type, items) {
				if (!items.length) { listEl.innerHTML = '<p class="wpab-chat__empty">Nothing here yet.</p>'; return; }
				listEl.innerHTML = '';
				items.forEach(function (it) {
					var el = document.createElement('div'); el.className = 'wpab-crow';
					var right = '';
					if (type === 'menu') { right = '<span class="wpab-cstatus">' + (it.count || 0) + ' items</span>'; }
					else if (type === 'media') { right = '<span class="wpab-cstatus">' + esc((it.mime || '').split('/').pop()) + '</span>'; }
					else { right = '<span class="wpab-cstatus wpab-cstatus--' + esc(it.status || '') + '">' + esc(it.status || '') + '</span>'; }
					var actions = '';
					if (it.edit_url) { actions += '<a href="' + esc(it.edit_url) + '" target="_blank" rel="noopener">Open in WP</a>'; }
					if (it.url) { actions += '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">View</a>'; }
					if (type !== 'menu' && type !== 'media') {
						actions += '<button type="button" class="wpab-editai" data-t="' + esc(type) + '" data-id="' + esc(it.id) + '" data-title="' + esc(it.title || '') + '">Edit with AI</button>';
					}
					el.innerHTML = '<div class="wpab-crow__top"><span class="wpab-crow__title">' + esc(it.title || '(no title)') + '</span>' + right + '</div>' +
						(actions ? '<div class="wpab-crow__actions">' + actions + '</div>' : '');
					listEl.appendChild(el);
				});
				var edits = listEl.querySelectorAll('.wpab-editai');
				for (var i = 0; i < edits.length; i++) {
					edits[i].addEventListener('click', function () {
						var t = this.getAttribute('data-t'), id = this.getAttribute('data-id'), title = this.getAttribute('data-title');
						askAbout('Edit the ' + t + ' "' + title + '" (id ' + id + '): ');
					});
				}
			}
			if (refreshBtn) { refreshBtn.addEventListener('click', loadTypes); }

			/* ---- Quick item picker (above the chat input) ---- */
			var pickType = $('wpab-pick-type');
			var pickItem = $('wpab-pick-item');
			var pickActions = $('wpab-pick-actions');
			var pickEdit = $('wpab-pick-edit');
			var pickOpen = $('wpab-pick-open');
			var pickItems = [];
			function pickCurrent() {
				for (var i = 0; i < pickItems.length; i++) { if (String(pickItems[i].id) === pickItem.value) { return pickItems[i]; } }
				return null;
			}
			function initPicker() {
				if (!cfg.connected || !pickType) { return; }
				api('GET', cfg.restContentTypes).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { return; }
					var types = (out.data.types || []).filter(function (t) {
						return (t.count > 0 || t.key === 'page' || t.key === 'post') && t.key !== 'menu' && t.key !== 'media';
					});
					types.forEach(function (t) {
						var o = document.createElement('option'); o.value = t.key; o.textContent = t.label;
						pickType.appendChild(o);
					});
				}).catch(function () {});
			}
			function pickLoadItems(type) {
				pickItem.innerHTML = '<option value="">loading…</option>'; pickItem.disabled = true; pickActions.hidden = true;
				api('GET', cfg.restContentList + '?type=' + encodeURIComponent(type) + '&limit=50').then(function (out) {
					pickItems = (out.data && out.data.items) || [];
					pickItem.innerHTML = '<option value="">pick an item…</option>';
					pickItems.forEach(function (it) {
						var o = document.createElement('option'); o.value = String(it.id); o.textContent = it.title || '(no title)';
						pickItem.appendChild(o);
					});
					pickItem.disabled = false;
				}).catch(function () { pickItem.innerHTML = '<option value="">could not load</option>'; });
			}
			if (pickType) {
				pickType.addEventListener('change', function () {
					if (this.value) { pickLoadItems(this.value); }
					else { pickItem.innerHTML = '<option value="">pick an item…</option>'; pickItem.disabled = true; pickActions.hidden = true; }
				});
			}
			if (pickItem) {
				pickItem.addEventListener('change', function () {
					var it = pickCurrent();
					if (!it) { pickActions.hidden = true; return; }
					pickActions.hidden = false;
					if (pickOpen) {
						if (it.edit_url) { pickOpen.href = it.edit_url; pickOpen.style.display = ''; }
						else { pickOpen.style.display = 'none'; }
					}
				});
			}
			if (pickEdit) {
				pickEdit.addEventListener('click', function () {
					if (!pickType.value || !pickItem.value) { return; }
					var it = pickCurrent();
					askAbout('Edit the ' + pickType.value + ' "' + (it ? (it.title || '') : '') + '" (id ' + pickItem.value + '): ');
				});
			}

			/* ---- SEO module (chip type picker + clickable list) ---- */
			var seoTabs = $('wpab-seo-tabs');
			var seoItemsEl = $('wpab-seo-items');
			var seoBody = $('wpab-seo-body');
			var seoPluginEl = $('wpab-seo-plugin');
			var seoActive = null;
			var seoWritable = false;
			var seoCurType = '';
			var seoAudit = [];
			var seoLastFocus = '';

			function seoLen(n, lo, hi) {
				var cls = (n >= lo && n <= hi) ? 'wpab-seo__len--ok' : 'wpab-seo__len--warn';
				return '<span class="wpab-seo__len ' + cls + '">' + n + '</span>';
			}
			function seoValRow(name, val, meta, copyable) {
				var v = String(val == null ? '' : val);
				var copy = (copyable && v) ? ' <button type="button" class="wpab-copybtn" data-copy="' + encodeURIComponent(v) + '">Copy</button>' : '';
				var body = v ? '<div class="wpab-seo__val">' + esc(v) + '</div>' : '<div class="wpab-seo__val wpab-seo__val--empty">&mdash; not set &mdash;</div>';
				return '<div class="wpab-seo__field"><div class="wpab-seo__fname"><span>' + esc(name) + copy + '</span>' + (meta || '') + '</div>' + body + '</div>';
			}
			function seoScoreBadge(label, n) {
				var cls = n >= 71 ? 'ok' : (n >= 41 ? 'warn' : 'bad');
				return '<span class="wpab-seo__score wpab-seo__score--' + cls + '">' + esc(label) + ' <strong>' + n + '</strong>/100</span>';
			}
			function runSeoOptimize() {
				if (!seoActive || !seoWritable || busy) { return; }
				setBusy(true);
				seoBody.innerHTML = '<p class="wpab-chat__empty"><span class="wpab-typing">Analyzing the page and drafting SEO…</span></p>';
				api('POST', cfg.restSeoPropose, { type: seoActive.type, id: seoActive.id }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { seoBody.innerHTML = '<p class="wpab-chat__empty">' + esc((out.data && (out.data.error || out.data.message)) || 'Could not draft SEO.') + '</p>'; return; }
					if (!out.data.proposal) { seoBody.innerHTML = '<p class="wpab-chat__empty">' + esc(out.data.message || 'SEO already looks good.') + '</p>'; return; }
					renderSeoProposal(out.data.proposal);
				}).catch(function () { seoBody.innerHTML = '<p class="wpab-chat__empty">Network error drafting SEO.</p>'; })
				.then(function () { setBusy(false); });
			}
			function renderSeoCurrent(d) {
				seoWritable = !!d.writable;
				seoLastFocus = d.focusKeyword || '';
				if (seoPluginEl) { seoPluginEl.textContent = d.plugin_label || ''; }
				var checks = d.checks || {};
				var a = d.analysis || {};
				var scoreParts = '';
				if (a.score != null) { scoreParts += seoScoreBadge('SEO score', a.score); }
				if (a.readability != null) { scoreParts += seoScoreBadge('Readability', a.readability); }
				if (a.word_count != null) { scoreParts += '<span class="wpab-seo__stat">' + a.word_count + ' words</span>'; }
				if (a.stats) { scoreParts += '<span class="wpab-seo__stat">' + (a.stats.links_internal || 0) + ' internal links</span>'; }
				var scoresRow = scoreParts ? '<div class="wpab-seo__scores">' + scoreParts + '</div>' : '';
				var warn = d.writable ? '' : '<p class="wpab-chat__empty">No SEO plugin detected — install Yoast SEO, Rank Math or All in One SEO to let the AI write these fields. Showing read-only.</p>';
				var checksHtml = (a.checks || []).map(function (c) {
					return '<div class="wpab-seo__check wpab-seo__check--' + esc(c.status) + '"><span class="wpab-seo__dot"></span><div class="wpab-seo__ckbody"><div class="wpab-seo__cklabel">' + esc(c.label) + '</div>' + (c.hint ? '<div class="wpab-seo__ckhint">' + esc(c.hint) + '</div>' : '') + '</div></div>';
				}).join('');
				var advHtml = '';
				var adv = d.advanced;
				if (adv && d.writable) {
					var idx = adv.robots_index ? '<span class="wpab-seo__len--ok">Indexed</span>' : '<span class="wpab-seo__len--warn">Noindex</span>';
					var fol = adv.robots_follow ? 'Follow' : 'Nofollow';
					var social = [];
					if (adv.og_title) { social.push('OG title'); }
					if (adv.og_description) { social.push('OG description'); }
					if (adv.og_image) { social.push('OG image'); }
					var rows = '<div class="wpab-seo__field"><div class="wpab-seo__fname"><span>Indexing</span></div><div class="wpab-seo__val">' + idx + ' · ' + esc(fol) + (adv.cornerstone ? ' · Cornerstone' : '') + '</div></div>';
					if (adv.canonical) { rows += seoValRow('Canonical URL', adv.canonical, ''); }
					rows += '<div class="wpab-seo__field"><div class="wpab-seo__fname"><span>Social preview</span></div><div class="wpab-seo__val' + (social.length ? '' : ' wpab-seo__val--empty') + '">' + (social.length ? esc(social.join(', ')) + ' set' : 'Not customized (uses defaults)') + '</div></div>';
					advHtml = '<div class="wpab-seo__checks"><div class="wpab-seo__ckhead">Advanced · ' + esc(d.plugin_label || '') + '</div>' + rows + '</div>';
				}
				var optBtn = d.writable ? '<div class="wpab-seo__optbar"><button type="button" class="button button-primary" id="wpab-seo-opt">Optimize meta with AI</button> <button type="button" class="button" id="wpab-seo-improve">Improve page content</button>' + (d.edit_url ? ' <a class="button" href="' + esc(d.edit_url) + '" target="_blank" rel="noopener">Open in WP</a>' : '') + '</div>' : '';
				seoBody.innerHTML = optBtn + warn + scoresRow +
					seoValRow('Meta title', d.metaTitle, seoLen((checks.title_len || 0), 30, 60) + '/60', true) +
					seoValRow('Meta description', d.metaDescription, seoLen((checks.desc_len || 0), 110, 160) + '/155', true) +
					seoValRow('Focus keyphrase', d.focusKeyword, '', false) +
					(checksHtml ? '<div class="wpab-seo__checks"><div class="wpab-seo__ckhead">Recommendations</div>' + checksHtml + '</div>' : '') +
					advHtml;
				var ob = $('wpab-seo-opt'); if (ob) { ob.addEventListener('click', runSeoOptimize); }
				var ib = $('wpab-seo-improve'); if (ib) { ib.addEventListener('click', improveContent); }
				var cps = seoBody.querySelectorAll('.wpab-copybtn');
				for (var ci = 0; ci < cps.length; ci++) {
					cps[ci].addEventListener('click', function () {
						var txt = decodeURIComponent(this.getAttribute('data-copy') || '');
						var self = this;
						if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(function () { self.textContent = 'Copied'; setTimeout(function () { self.textContent = 'Copy'; }, 1200); }).catch(function () {}); }
					});
				}
			}
			function renderSeoProposal(p) {
				var changesHtml = (p.changes || []).map(function (c) {
					var nm = c.field === 'metaTitle' ? 'Meta title' : (c.field === 'metaDescription' ? 'Meta description' : (c.field === 'focusKeyword' ? 'Focus keyphrase' : c.field));
					return '<div class="wpab-ce-field"><div class="wpab-ce-fname">' + esc(nm) + '</div>' +
						(String(c.before) !== '' ? '<div class="wpab-ce-before">' + esc(ceTrunc(c.before, 400)) + '</div>' : '') +
						'<div class="wpab-ce-after">' + esc(ceTrunc(c.after, 400)) + '</div></div>';
				}).join('');
				seoBody.innerHTML = '<div class="wpab-ce"><div class="wpab-ce__head"><span class="wpab-ce__pill">seo</span><h4 class="wpab-ce__title">' + esc(p.summary || 'SEO improvements') + '</h4></div>' +
					'<p class="wpab-ce__meta">' + esc(p.title || '') + '</p>' + changesHtml +
					'<div class="wpab-ce__actions"><button type="button" class="button button-primary wpab-seo-apply">Apply to SEO plugin</button><button type="button" class="button wpab-seo-cancel">Cancel</button></div><div class="wpab-ce__status"></div></div>';
				var card = seoBody.querySelector('.wpab-ce');
				card.querySelector('.wpab-seo-apply').addEventListener('click', function () { applySeo(p, p.fields, card, false); });
				card.querySelector('.wpab-seo-cancel').addEventListener('click', function () { if (seoActive) { seoLoadCurrent(seoActive.type, seoActive.id); } });
			}
			function applySeo(p, fields, card, isUndo) {
				if (busy) { return; }
				setBusy(true);
				var slot = card.querySelector('.wpab-ce__status');
				if (slot) { slot.innerHTML = isUndo ? 'Reverting…' : 'Writing to your SEO plugin…'; }
				api('POST', cfg.restSeoApply, { type: p.type, id: p.id, fields: fields }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) {
						if (slot) { slot.innerHTML = '<span style="color:#b32d2e">' + esc((out.data && (out.data.error || out.data.message)) || 'Update failed.') + '</span>'; }
						return;
					}
					var view = out.data.url ? ' · <a href="' + esc(out.data.url) + '" target="_blank" rel="noopener">View</a>' : '';
					if (slot) {
						slot.innerHTML = '<span style="color:#00733f">' + (isUndo ? 'Reverted &#10003;' : 'Applied &#10003;') + '</span>' + view;
						if (!isUndo && p.before) {
							var undoBtn = document.createElement('button'); undoBtn.type = 'button'; undoBtn.className = 'button'; undoBtn.textContent = 'Undo'; undoBtn.style.marginLeft = '8px';
							undoBtn.addEventListener('click', function () { applySeo(p, p.before, card, true); });
							slot.appendChild(undoBtn);
						}
					}
					var ab = card.querySelector('.wpab-seo-apply'); if (ab) { ab.disabled = true; ab.textContent = isUndo ? 'Reverted' : 'Applied'; }
					if (seoActive) { loadSeoItems(seoActive.type); }
				}).catch(function () { if (slot) { slot.innerHTML = '<span style="color:#b32d2e">Network request failed.</span>'; } })
				.then(function () { setBusy(false); });
			}
			function seoLoadCurrent(type, id) {
				seoActive = { type: type, id: id };
				var rows = seoItemsEl.querySelectorAll('.wpab-seo__item');
				for (var i = 0; i < rows.length; i++) { rows[i].classList.toggle('is-active', rows[i].getAttribute('data-id') === String(id)); }
				seoBody.innerHTML = '<p class="wpab-chat__empty">Loading current SEO…</p>';
				api('GET', cfg.restSeoGet + '?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id)).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { seoBody.innerHTML = '<p class="wpab-chat__empty">Could not load SEO for this item.</p>'; return; }
					renderSeoCurrent(out.data);
				}).catch(function () { seoBody.innerHTML = '<p class="wpab-chat__empty">Could not reach WordPress.</p>'; });
			}
			function seoGradeBadge(it) {
				if (it.score != null) {
					var scls = it.score >= 71 ? 'good' : (it.score >= 41 ? 'warn' : 'bad');
					return '<span class="wpab-seo__grade wpab-seo__grade--' + scls + '" title="SEO score">' + it.score + '</span>';
				}
				if (it.issues === 0) { return '<span class="wpab-seo__grade wpab-seo__grade--good" title="No issues">OK</span>'; }
				return '<span class="wpab-seo__grade wpab-seo__grade--' + esc(it.grade) + '" title="Needs attention">' + it.issues + '&#9888;</span>';
			}
			function loadSeoItems(type) {
				seoItemsEl.innerHTML = '<p class="wpab-chat__empty">Auditing…</p>';
				api('GET', cfg.restSeoAudit + '?type=' + encodeURIComponent(type) + '&limit=200').then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { seoItemsEl.innerHTML = '<p class="wpab-chat__empty">Could not load items. ' + esc((out.data && (out.data.message || out.data.error)) || ('HTTP ' + out.status)) + '</p>'; return; }
					var items = out.data.items || [];
					seoCurType = type; seoAudit = items;
					if (!items.length) {
						var sk = (out.data.skipped && out.data.skipped.length) ? ' (' + esc(out.data.skipped.join('; ')) + ')' : '';
						seoItemsEl.innerHTML = '<p class="wpab-chat__empty">Nothing here yet.' + sk + '</p>'; return;
					}
					seoItemsEl.innerHTML = '<div class="wpab-seo__summary">' + out.data.count + ' items · <strong>' + out.data.need_work + '</strong> need attention</div>';
					if (out.data.need_work > 0) {
						var bulk = document.createElement('button');
						bulk.type = 'button'; bulk.className = 'button wpab-seo__bulk';
						bulk.textContent = 'Optimize all needing attention (' + out.data.need_work + ')';
						bulk.addEventListener('click', bulkOptimize);
						seoItemsEl.appendChild(bulk);
					}
					items.forEach(function (it) {
						var el = document.createElement('div'); el.className = 'wpab-seo__item'; el.setAttribute('data-id', String(it.id));
						el.innerHTML = '<span class="wpab-seo__itemtitle">' + esc(it.title || '(no title)') + '</span>' + seoGradeBadge(it);
						el.addEventListener('click', function () { seoLoadCurrent(type, it.id); });
						seoItemsEl.appendChild(el);
					});
				}).catch(function () { seoItemsEl.innerHTML = '<p class="wpab-chat__empty">Could not load items.</p>'; });
			}
			function seoSelectType(type) {
				var btns = seoTabs.querySelectorAll('.wpab-ctab');
				for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle('is-active', btns[i].getAttribute('data-type') === type); }
				loadSeoItems(type);
			}
			function bulkOptimize() {
				if (busy) { return; }
				var needy = seoAudit.filter(function (it) { return it.grade !== 'good'; }).slice(0, 25);
				if (!needy.length) { return; }
				setBusy(true);
				seoBody.innerHTML = '<div class="wpab-ce"><div class="wpab-ce__head"><span class="wpab-ce__pill">seo</span><h4 class="wpab-ce__title">Optimizing ' + needy.length + ' item(s)…</h4></div><div id="wpab-bulk-log"></div><div class="wpab-ce__status" id="wpab-bulk-done"></div></div>';
				var log = $('wpab-bulk-log');
				var t = seoCurType;
				var i = 0, okc = 0;
				function step() {
					if (i >= needy.length) {
						var done = $('wpab-bulk-done'); if (done) { done.innerHTML = '<span style="color:#00733f">Done &#10003; ' + okc + ' optimized.</span>'; }
						setBusy(false); loadSeoItems(t); return;
					}
					var it = needy[i++];
					var row = document.createElement('div'); row.className = 'wpab-bulk-row';
					row.innerHTML = esc(it.title || '(no title)') + ' — <span class="wpab-typing">optimizing…</span>';
					log.appendChild(row);
					api('POST', cfg.restSeoPropose, { type: t, id: it.id }).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false || !out.data.proposal) {
							row.innerHTML = esc(it.title || '') + ' — <span style="color:#8a6d00">skipped</span>'; step(); return;
						}
						var p = out.data.proposal;
						api('POST', cfg.restSeoApply, { type: p.type, id: p.id, fields: p.fields }).then(function (a) {
							var good = a.ok && a.data && a.data.success !== false;
							if (good) { okc++; }
							row.innerHTML = esc(it.title || '') + ' — ' + (good ? '<span style="color:#00733f">optimized &#10003;</span>' : '<span style="color:#b32d2e">error</span>');
							step();
						}).catch(function () { row.innerHTML = esc(it.title || '') + ' — <span style="color:#b32d2e">error</span>'; step(); });
					}).catch(function () { row.innerHTML = esc(it.title || '') + ' — <span style="color:#b32d2e">error</span>'; step(); });
				}
				step();
			}
			function improveContent() {
				if (!seoActive || busy) { return; }
				setBusy(true);
				seoBody.innerHTML = '<p class="wpab-chat__empty"><span class="wpab-typing">Drafting content improvements for SEO…</span></p>';
				var instr = 'Improve this page\'s on-page SEO content' + (seoLastFocus ? ' for the focus keyphrase "' + seoLastFocus + '"' : '') + ': make sure the keyphrase appears naturally in the first paragraph and in at least one subheading, expand any thin sections with useful copy, and keep valid WordPress block markup. Do not change the meta title or meta description.';
				api('POST', cfg.restContentPropose, { type: seoActive.type, id: seoActive.id, instruction: instr }).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { seoBody.innerHTML = '<p class="wpab-chat__empty">' + esc((out.data && (out.data.error || out.data.message)) || 'Could not draft the change.') + '</p>'; return; }
					if (!out.data.proposal) { seoBody.innerHTML = '<p class="wpab-chat__empty">' + esc(out.data.message || 'No change was needed.') + '</p>'; return; }
					renderContentEditCard(out.data.proposal, seoBody);
				}).catch(function () { seoBody.innerHTML = '<p class="wpab-chat__empty">Network error drafting the change.</p>'; })
				.then(function () { setBusy(false); });
			}
			function initSeoSite() {
				var bar = $('wpab-seo-sitebar');
				if (!bar || !cfg.connected) { return; }
				api('GET', cfg.restSeoSite).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { return; }
					var d = out.data;
					if (!d.search_public) {
						bar.innerHTML = '<div class="wpab-seo__hidden">&#9888; Your site is <strong>hidden from search engines</strong>. Fix this first: <a href="' + esc(d.reading_url) + '" target="_blank" rel="noopener">Settings &rarr; Reading</a> &rarr; uncheck &ldquo;Discourage search engines&rdquo;.</div>';
						return;
					}
					var sm = d.sitemap_url ? '<span><a href="' + esc(d.sitemap_url) + '" target="_blank" rel="noopener">XML sitemap</a></span>' : '';
					bar.innerHTML = '<div class="wpab-seo__sitebar"><span>Search engines: <strong style="color:#00733f">visible</strong></span><span>' + esc(d.plugin_label || '') + '</span>' + sm + '</div>';
				}).catch(function () {});
			}
			function initSeo() {
				if (!cfg.seoEnabled || !cfg.connected || !seoTabs) { return; }
				initSeoSite();
				api('GET', cfg.restContentTypes).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { return; }
					var types = (out.data.types || []).filter(function (t) {
						return (t.count > 0 || t.key === 'page' || t.key === 'post') && t.key !== 'menu' && t.key !== 'media';
					});
					seoTabs.innerHTML = '';
					types.forEach(function (t) {
						var b = document.createElement('button'); b.type = 'button'; b.className = 'wpab-ctab'; b.setAttribute('data-type', t.key);
						b.innerHTML = esc(t.label) + '<span class="wpab-ctab__count">' + (t.count || 0) + '</span>';
						b.addEventListener('click', function () { seoSelectType(t.key); });
						seoTabs.appendChild(b);
					});
					if (types.length) { seoSelectType(types[0].key); }
				}).catch(function () {});
			}

			/* ---- Insights module (AI site scan) ---- */
			var insRun = $('wpab-insights-run');
			var insBody = $('wpab-insights-body');
			function insField(label, val) {
				if (val == null || val === '') { return ''; }
				var body;
				if (Object.prototype.toString.call(val) === '[object Array]') {
					if (!val.length) { return ''; }
					body = '<ul style="margin:5px 0 0 18px">' + val.map(function (x) { return '<li style="margin-bottom:3px">' + esc(String(x)) + '</li>'; }).join('') + '</ul>';
				} else {
					body = '<div class="wpab-seo__val">' + esc(String(val)) + '</div>';
				}
				return '<div class="wpab-seo__field"><div class="wpab-seo__fname"><span>' + esc(label) + '</span></div>' + body + '</div>';
			}
			function renderInsights(u) {
				u = u || {};
				var html = insField('What this site is', u.biography || u.identity)
					+ insField('Who it is for', u.audience)
					+ insField('Problem it solves', u.problem_solved || u.problem)
					+ insField('Objective', u.objective)
					+ insField('Positioning', u.positioning || u.standpoint)
					+ insField('Economic outlook', u.economic_outlook || u.economical)
					+ insField('Strengths', u.strengths)
					+ insField('Risks', u.risks);
				insBody.innerHTML = html || '<p class="wpab-chat__empty">No insights returned.</p>';
			}
			if (insRun && insBody) {
				insRun.addEventListener('click', function () {
					if (busy) { return; }
					setBusy(true); insRun.disabled = true;
					insBody.innerHTML = '<p class="wpab-chat__empty"><span class="wpab-typing">Scanning the site and forming an understanding… this can take up to a minute.</span></p>';
					api('POST', cfg.restUnderstand, {}).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) {
							insBody.innerHTML = '<p class="wpab-chat__empty">' + esc((out.data && (out.data.error || out.data.message)) || 'Could not scan the site.') + '</p>';
							return;
						}
						renderInsights(out.data.understanding || out.data);
					}).catch(function () { insBody.innerHTML = '<p class="wpab-chat__empty">Network error scanning the site.</p>'; })
					.then(function () { setBusy(false); insRun.disabled = false; });
				});
			}

			/* ---- Home: site at a glance ---- */
			var glanceBody = $('wpab-glance-body');
			function initGlance() {
				if (!cfg.connected || !glanceBody) { return; }
				api('GET', cfg.restContentTypes).then(function (out) {
					if (!out.ok || !out.data || out.data.success === false) { glanceBody.innerHTML = '<p class="wpab-chat__empty">Could not load content overview.</p>'; return; }
					var types = (out.data.types || []).filter(function (t) { return t.count > 0 || t.key === 'page' || t.key === 'post'; });
					if (!types.length) { glanceBody.innerHTML = '<p class="wpab-chat__empty">No content yet.</p>'; return; }
					glanceBody.innerHTML = types.map(function (t) {
						return '<div class="wpab-glance__tile"><div class="wpab-glance__num">' + (t.count || 0) + '</div><div class="wpab-glance__label">' + esc(t.label) + '</div></div>';
					}).join('');
				}).catch(function () { glanceBody.innerHTML = '<p class="wpab-chat__empty">Could not reach WordPress.</p>'; });
			}

			/* ---- Builder wizard ---- */
			var bGen = $('wpab-b-generate');
			if (bGen) {
				var lastBrief = null;
				function generateSite(btn) {
					if (busy || !lastBrief) { return; }
					var pr = $('wpab-pages-result');
					setBusy(true); btn.disabled = true;
					pr.innerHTML = '<p class="wpab-chat__empty"><span class="wpab-typing">Designing and creating your pages… this can take up to a minute.</span></p>';
					api('POST', cfg.restBuildSite, lastBrief).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) {
							pr.innerHTML = '<div class="wpab-build__err">' + esc((out.data && (out.data.message || out.data.error)) || 'Could not generate pages.') + '</div>';
							btn.disabled = false; return;
						}
						var pages = out.data.pages || [];
						var patterns = out.data.patterns || 0;
						var list = pages.map(function (p) { return '<li><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' + (p.front ? ' <em>(home)</em>' : '') + '</li>'; }).join('');
						pr.innerHTML = '<div class="wpab-build__ok"><strong>&#10003; ' + pages.length + ' page(s) created' + (patterns ? ' · ' + patterns + ' reusable sections added' : '') + '.</strong><ul style="margin:8px 0 0 18px">' + list + '</ul>'
							+ '<p style="margin:10px 0 0;color:#3c434a;font-size:13px">Your home page is set' + (patterns ? ', and your on-brand sections are in the block inserter under &ldquo;Escanor&rdquo;' : '') + '. Refine any page in Content chat, or open the Site Editor.</p>'
							+ '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e4e7">'
							+ '<label style="font-weight:600;display:block;margin-bottom:6px">AI images</label>'
							+ '<select id="wpab-img-count" style="margin-right:8px"><option value="2">2 images</option><option value="3">3 images</option><option value="4" selected>4 images</option></select>'
							+ '<button type="button" class="button button-primary" id="wpab-b-images">Generate images</button> <span class="wpab-build__note">On-brand photos, saved to your media library and placed as a gallery on the home page.</span>'
							+ '<div id="wpab-images-result" style="margin-top:12px"></div></div></div>';
						btn.textContent = 'Done';
						var ib = $('wpab-b-images'); if (ib) { ib.addEventListener('click', function () { generateImages(ib); }); }
					}).catch(function () { pr.innerHTML = '<div class="wpab-build__err">Network error generating pages.</div>'; btn.disabled = false; })
					.then(function () { setBusy(false); });
				}
					function generateImages(btn) {
						if (busy || !lastBrief) { return; }
						var ir = $('wpab-images-result');
						var sel = $('wpab-img-count');
						var count = sel ? (parseInt(sel.value, 10) || 4) : 4;
						if (count < 1) { count = 1; } if (count > 4) { count = 4; }
						setBusy(true); btn.disabled = true; if (sel) { sel.disabled = true; }
						var thumbs = new Array(count);
						var ids = [];
						function render(status) {
							var cells = '';
							for (var j = 0; j < count; j++) {
								var t = thumbs[j];
								if (t === 'ok') {
									cells += '<div style="width:96px;height:96px;border-radius:8px;overflow:hidden;background:#f0f0f1"><img src="' + esc((ids[j] && ids[j].url) || '') + '" alt="" style="width:100%;height:100%;object-fit:cover"/></div>';
								} else if (t === 'fail') {
									cells += '<div style="width:96px;height:96px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fcebea;color:#a00;font-size:20px">&times;</div>';
								} else {
									cells += '<div style="width:96px;height:96px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#f0f0f1;color:#787c82"><span class="wpab-typing">&hellip;</span></div>';
								}
							}
							ir.innerHTML = '<p style="margin:0 0 8px;color:#3c434a;font-size:13px">' + esc(status) + '</p><div style="display:flex;gap:8px;flex-wrap:wrap">' + cells + '</div>';
						}
						render('Generating image 1 of ' + count + '\u2026 this can take a moment each.');
						var i = 0;
						function next() {
							if (i >= count) {
								var goodIds = [];
								for (var k = 0; k < ids.length; k++) { if (ids[k] && ids[k].id) { goodIds.push(ids[k].id); } }
								if (!goodIds.length) {
									ir.innerHTML = '<div class="wpab-build__err">No images could be generated. Check the image model is available on your account.</div>';
									btn.disabled = false; if (sel) { sel.disabled = false; } setBusy(false); return;
								}
								render('Placing your gallery on the home page\u2026');
								api('POST', cfg.restBuildGallery, { ids: goodIds }).then(function (gout) {
									var ok = gout.ok && gout.data && gout.data.success !== false;
									var home = (gout.data && gout.data.home_url) || '';
									ir.innerHTML = '<div class="wpab-build__ok"><strong>&#10003; ' + goodIds.length + ' image(s) added to your media library' + (ok ? ' and placed as a gallery on your home page' : '') + '.</strong>'
										+ (ok && home ? '<div style="margin-top:8px"><a class="button" href="' + esc(home) + '" target="_blank" rel="noopener">View home page</a></div>' : '')
										+ (!ok ? '<p style="margin:8px 0 0;color:#a00;font-size:13px">The images were saved but the gallery could not be placed automatically \u2014 add them from the media library.</p>' : '')
										+ '</div>';
									btn.textContent = 'Done';
								}).catch(function () {
									ir.innerHTML = '<div class="wpab-build__err">Images were saved, but placing the gallery failed. Add them from the media library.</div>';
								}).then(function () { if (sel) { sel.disabled = false; } setBusy(false); });
								return;
							}
							render('Generating image ' + (i + 1) + ' of ' + count + '\u2026 this can take a moment each.');
							var payload = {
								brand: lastBrief.brand, tagline: lastBrief.tagline,
								site_type: lastBrief.site_type, style: lastBrief.style, index: i
							};
							api('POST', cfg.restBuildImage, payload).then(function (out) {
								if (out.ok && out.data && out.data.success !== false && out.data.image) {
									ids[i] = out.data.image; thumbs[i] = 'ok';
								} else {
									ids[i] = null; thumbs[i] = 'fail';
								}
							}).catch(function () { ids[i] = null; thumbs[i] = 'fail'; })
							.then(function () { render('Generated ' + (i + 1) + ' of ' + count + '\u2026'); i++; next(); });
						}
						next();
					}
				var bColor = $('wpab-b-color'), bColorHex = $('wpab-b-colorhex');
				if (bColor && bColorHex) {
					bColor.addEventListener('input', function () { bColorHex.value = bColor.value; });
					bColorHex.addEventListener('input', function () { if (/^#[0-9a-fA-F]{6}$/.test(bColorHex.value)) { bColor.value = bColorHex.value; } });
				}
				bGen.addEventListener('click', function () {
					if (busy) { return; }
					var result = $('wpab-build-result');
					var brand = ($('wpab-b-brand').value || '').trim();
					if (!brand) { result.innerHTML = '<div class="wpab-build__err">Please enter a site name.</div>'; return; }
					setBusy(true); bGen.disabled = true;
					result.innerHTML = '<p class="wpab-chat__empty"><span class="wpab-typing">Generating your theme… this takes a few seconds.</span></p>';
					var payload = {
						brand: brand,
						tagline: ($('wpab-b-tagline').value || '').trim(),
						site_type: $('wpab-b-type').value,
						style: $('wpab-b-style').value,
						primary: (bColorHex && bColorHex.value) || '#3a5bff',
						font: $('wpab-b-font').value,
						dark: $('wpab-b-base').value === 'dark'
					};
					api('POST', cfg.restBuildTheme, payload).then(function (out) {
						if (!out.ok || !out.data || out.data.success === false) {
							result.innerHTML = '<div class="wpab-build__err">' + esc((out.data && (out.data.message || out.data.error)) || 'Could not generate the theme.') + '</div>';
							bGen.disabled = false; return;
						}
						var d = out.data;
						lastBrief = payload;
						result.innerHTML = '<div class="wpab-build__ok"><strong>&#10003; Your theme &ldquo;' + esc(d.theme_name) + '&rdquo; is live.</strong>'
							+ '<div style="margin-top:8px">'
							+ (d.preview_url ? '<a class="button" href="' + esc(d.preview_url) + '" target="_blank" rel="noopener">View site</a> ' : '')
							+ (d.editor_url ? '<a class="button" href="' + esc(d.editor_url) + '" target="_blank" rel="noopener">Open Site Editor</a>' : '')
							+ '</div>'
							+ '<div style="margin-top:12px"><button type="button" class="button button-primary" id="wpab-b-pages">Generate starter pages with AI</button> <span class="wpab-build__note">Creates a home page + a few pages, and sets the home page &amp; menu.</span></div>'
							+ '<div id="wpab-pages-result" style="margin-top:12px"></div></div>';
						bGen.textContent = 'Generate another';
						var pb = $('wpab-b-pages'); if (pb) { pb.addEventListener('click', function () { generateSite(pb); }); }
					}).catch(function () { result.innerHTML = '<div class="wpab-build__err">Network error generating the theme.</div>'; bGen.disabled = false; })
					.then(function () { setBusy(false); });
				});
			}

			loadTypes();
			initPicker();
			initSeo();
			initGlance();
		})();
		</script>
		<?php
	}
}
