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
        Map<Id<Link>, String> origin = new HashMap<>();
        for (Link l : network.getLinks().values()) {
            Object way = l.getAttributes().getAttribute("origid");
            origin.put(l.getId(), way == null ? "" : way.toString());
        }
        new NetworkCleaner().run(network);
        // OSM way ids whose links the cleaner dropped: agents can never use them.
        SortedSet<String> removed = new TreeSet<>();
        int removedLinks = 0;
        for (Map.Entry<Id<Link>, String> e : origin.entrySet()) {
            if (network.getLinks().containsKey(e.getKey())) continue;
            removedLinks++;
            if (!e.getValue().isEmpty()) removed.add(e.getValue());
        }
        if (args.length > 1) NetworkUtils.writeNetwork(network, args[1]);
        StringBuilder sb = new StringBuilder();
        sb.append("{\"nodes\":").append(nodes)
          .append(",\"links\":").append(links)
          .append(",\"lengthKm\":").append(String.format(Locale.ROOT, "%.2f", length / 1000))
          .append(",\"zeroCapacity\":").append(zeroCap)
          .append(",\"zeroSpeed\":").append(zeroSpeed)
          .append(",\"linksAfterCleaning\":").append(network.getLinks().size())
          .append(",\"removedLinks\":").append(removedLinks)
          .append(",\"removedWays\":[");
        int i = 0;
        for (String way : removed) { if (i++ > 0) sb.append(','); sb.append('"').append(way).append('"'); }
        sb.append("]}");
        System.out.println("RESULT " + sb);
    }
}
