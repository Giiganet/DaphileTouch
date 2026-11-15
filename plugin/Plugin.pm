package Plugins::DaphileTouch::Plugin;

# DaphileTouch: a touch-friendly web player for tablets.
# The plugin ships static files under HTML/EN/plugins/DaphileTouch/,
# served at http://<server>:9000/plugins/DaphileTouch/index.html .
# The page talks to LMS through the standard JSON-RPC endpoint (/jsonrpc.js);
# no settings or extra processes are added.
#
# Why a page function is needed: LMS (Slim::Web::HTTP) streams .js/.css files
# from plugin HTML folders as static content, but a .html path is only served
# if its path contains "html/" or a page function is registered for it.
# We register one for the entry page and return the file as-is (no template
# processing), so the page is delivered byte for byte.

use strict;
use base qw(Slim::Plugin::Base);

use File::Basename qw(dirname);
use File::Spec::Functions qw(catfile);

use Slim::Utils::Log;
use Slim::Web::Pages;

my $log = Slim::Utils::Log->addLogCategory({
	category     => 'plugin.daphiletouch',
	defaultLevel => 'WARN',
	description  => 'PLUGIN_DAPHILETOUCH',
});

my $indexFile = catfile(dirname(__FILE__), 'HTML', 'EN', 'plugins', 'DaphileTouch', 'index.html');

sub initPlugin {
	my $class = shift;
	$class->SUPER::initPlugin(@_);

	# matches "plugins/DaphileTouch/" and "plugins/DaphileTouch/index.html"
	Slim::Web::Pages->addPageFunction(qr{^plugins/DaphileTouch/(?:index\.html?)?$}i, \&_indexPage);

	main::INFOLOG && $log->is_info && $log->info("DaphileTouch ready at /plugins/DaphileTouch/index.html ($indexFile)");
}

sub _indexPage {
	my ($client, $params, $callback, $httpClient, $response) = @_;

	my $html;
	if (open(my $fh, '<:raw', $indexFile)) {
		local $/;
		$html = <$fh>;
		close($fh);
	}
	else {
		$log->error("Cannot read $indexFile: $!");
		$html = '<!doctype html><meta charset="utf-8"><p>DaphileTouch: index.html not found.</p>';
	}

	# the entry page must never be cached, so a new release shows up right away
	if ($response) {
		$response->header('Cache-Control' => 'no-cache');
	}

	return \$html;
}

1;
