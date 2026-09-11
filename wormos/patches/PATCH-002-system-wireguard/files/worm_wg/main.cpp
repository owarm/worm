#include <errno.h>
#include <linux/genetlink.h>
#include <linux/netlink.h>
#include <linux/wireguard.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>

int main() {
    int fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_GENERIC);
    if (fd < 0) {
        std::fprintf(stderr,
                     "worm_wg: NETLINK_GENERIC socket failed: %s\n",
                     std::strerror(errno));
        return 1;
    }

    sockaddr_nl addr{};
    addr.nl_family = AF_NETLINK;

    if (bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::fprintf(stderr,
                     "worm_wg: netlink bind failed: %s\n",
                     std::strerror(errno));
        close(fd);
        return 2;
    }

    std::printf("worm_wg: Generic Netlink available\n");
    std::printf("worm_wg: WireGuard UAPI version=%u\n",
                WIREGUARD_GENL_VERSION);

    close(fd);
    return 0;
}
