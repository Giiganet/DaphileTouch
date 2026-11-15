package Plugins::DaphileTouch::Plugin;

# DaphileTouch: a touch-friendly web player for tablets.
# The plugin only ships static files under HTML/EN/plugins/DaphileTouch/,
# which LMS serves at http://<server>:9000/plugins/DaphileTouch/index.html .
# The page talks to LMS through the standard JSON-RPC endpoint (/jsonrpc.js);
# no server-side code, settings or extra processes are added.

use strict;
use base qw(Slim::Plugin::Base);

use Slim::Utils::Log;

my $log = Slim::Utils::Log->addLogCategory({
	category     => 'plugin.daphiletouch',
	defaultLevel => 'WARN',
	description  => 'PLUGIN_DAPHILETOUCH',
});

sub initPlugin {
	my $class = shift;
	$class->SUPER::initPlugin(@_);
	main::INFOLOG && $log->is_info && $log->info('DaphileTouch ready at /plugins/DaphileTouch/index.html');
}

1;
