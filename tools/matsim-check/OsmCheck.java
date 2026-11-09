import java.util.*;
import org.matsim.api.core.v01.Id;
import org.matsim.api.core.v01.network.*;
import org.matsim.core.network.NetworkUtils;
import org.matsim.core.network.algorithms.NetworkCleaner;
import org.matsim.core.utils.geometry.CoordinateTransformation;
import org.matsim.core.utils.geometry.transformations.TransformationFactory;
import org.matsim.core.utils.io.OsmNetworkReader;

/**
 * Builds a MATSim network from an .osm file the same way the check server does
 * (OsmNetworkReader with highway defaults) and prints a JSON summary.
 */
public class OsmCheck {
    public static void main(String[] args) {
        if (args.length < 1) { System.err.println("usage: OsmCheck <file.osm> [network.xml]"); System.exit(2); }
        Network network = NetworkUtils.createNetwork();
        CoordinateTransformation ct = TransformationFactory.getCoordinateTransformation(TransformationFactory.WGS84, "EPSG:32648");
        new OsmNetworkReader(network, ct, true, true).parse(args[0]);
        int nodes = network.getNodes().size();
        int links = network.getLinks().size();
        double length = 0, capacity = 0;
        int zeroCap = 0, zeroSpeed = 0;
        for (Link l : network.getLinks().values()) {
            length += l.getLength();
            capacity += l.getCapacity();
            if (l.getCapacity() <= 0) zeroCap++;
            if (l.getFreespeed() <= 0) zeroSpeed++;
        }
        Set<Id<Link>> before = new HashSet<>(network.getLinks().keySet());
        new NetworkCleaner().run(network);
        List<String> removed = new ArrayList<>();
        for (Id<Link> id : before) if (!network.getLinks().containsKey(id)) removed.add(id.toString());
        if (args.length > 1) NetworkUtils.writeNetwork(network, args[1]);
        StringBuilder sb = new StringBuilder();
        sb.append("{\"nodes\":").append(nodes)
          .append(",\"links\":").append(links)
          .append(",\"lengthKm\":").append(String.format(Locale.ROOT, "%.2f", length / 1000))
          .append(",\"zeroCapacity\":").append(zeroCap)
          .append(",\"zeroSpeed\":").append(zeroSpeed)
          .append(",\"linksAfterCleaning\":").append(network.getLinks().size())
          .append(",\"removedByCleaner\":[");
        for (int i = 0; i < removed.size(); i++) { if (i > 0) sb.append(','); sb.append('"').append(removed.get(i)).append('"'); }
        sb.append("]}");
        System.out.println("RESULT " + sb);
    }
}
